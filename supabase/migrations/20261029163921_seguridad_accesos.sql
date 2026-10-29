-- =========================================================
-- SEGURIDAD DE ACCESOS
--
-- 1. Bloqueo temporal por intentos fallidos: 5 intentos fallidos
--    seguidos (en 15 minutos) bloquean la cuenta 15 minutos. Lo
--    controla intentar_acceso(), que los dos logins llaman antes de
--    iniciar sesión; Soporte TI ve las cuentas bloqueadas y puede
--    desbloquearlas.
--    Bloqueos y desbloqueos quedan en la auditoría.
-- 2. Solo las cuentas creadas por Soporte TI (app_metadata, que el
--    usuario no puede escribir) son personal; cualquier otro
--    registro es cliente de la tienda.
-- 3. Mínimo privilegio: anon y authenticated pierden TRUNCATE,
--    REFERENCES, TRIGGER y MAINTAIN en las tablas (también en las
--    tablas que se creen después), y PUBLIC pierde EXECUTE en las
--    funciones que lo tenían por defecto.
--
-- Afecta:
--   intentos_acceso, eventos_seguridad          (tablas nuevas, RLS sin políticas)
--   intentar_acceso()                            (anon y authenticated: los logins)
--   estado_bloqueo_acceso(), registrar_intento_acceso()  (internas)
--   cuentas_bloqueadas(), desbloquear_cuenta()   (Soporte TI)
--   handle_new_user()                            (personal solo por app_metadata)
--   auditoria_sistema()                          (rama "Seguridad")
--   privilegios de tablas y funciones existentes
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. MÍNIMO PRIVILEGIO
-- ---------------------------------------------------------

-- TRUNCATE ignora RLS; REFERENCES, TRIGGER y MAINTAIN no los usa
-- ningún rol de la aplicación.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

-- Funciones que heredaban EXECUTE para PUBLIC (y por eso anon).
-- authenticated conserva su permiso explícito en las tres primeras;
-- las de trigger no necesitan EXECUTE para dispararse.
REVOKE EXECUTE ON FUNCTION public.current_role_code() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.anular_compra(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_movimiento_inventario(bigint, text, numeric, text, text) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.sincronizar_unidad_medida_producto() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crear_existencia_producto() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validar_limite_credito() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.actualizar_costos_recepcion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vincular_movimiento_inventario() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.set_updated_at() SET search_path = public;


-- ---------------------------------------------------------
-- 2. ALTAS: PERSONAL SOLO DESDE SOPORTE TI
-- raw_app_meta_data solo lo escribe la service_role (Edge Function
-- gestionar-usuarios). Lo que el usuario manda en user_metadata ya
-- no basta para convertirse en personal.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_es_personal boolean;
  v_nombre text;
BEGIN
  v_es_personal :=
    lower(coalesce(new.raw_app_meta_data ->> 'account_type', '')) = 'personal';

  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuario'), '@', 1)
  );

  IF NOT v_es_personal THEN
    INSERT INTO public.clientes_web (
      id, nombre, correo, telefono, direccion, activo
    )
    VALUES (
      new.id,
      v_nombre,
      coalesce(new.email, ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'address', '')), ''),
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre = excluded.nombre,
      correo = excluded.correo,
      telefono = excluded.telefono,
      direccion = excluded.direccion,
      activo = true,
      updated_at = now();
  ELSE
    INSERT INTO public.profiles (
      id, nombre_completo, correo
    )
    VALUES (
      new.id, v_nombre, new.email
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre_completo = coalesce(
        public.profiles.nombre_completo,
        excluded.nombre_completo
      ),
      correo = coalesce(excluded.correo, public.profiles.correo),
      updated_at = now();
  END IF;

  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------
-- 3. TABLAS DE CONTROL DE ACCESO
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.intentos_acceso (
  correo text PRIMARY KEY,
  fallidos integer NOT NULL DEFAULT 0,
  primer_fallo timestamptz,
  ultimo_fallo timestamptz,
  bloqueado_hasta timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eventos_seguridad (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento text NOT NULL,
  correo text NOT NULL,
  detalle text NOT NULL,
  realizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_seguridad_evento_check CHECK (evento IN ('bloqueo', 'desbloqueo'))
);

CREATE INDEX IF NOT EXISTS idx_eventos_seguridad_fecha
ON public.eventos_seguridad (created_at DESC);

-- Solo se accede por las funciones de abajo.
ALTER TABLE public.intentos_acceso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_seguridad ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intentos_acceso FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.eventos_seguridad FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------
-- 4. BLOQUEO POR INTENTOS
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estado_bloqueo_acceso(p_correo text)
RETURNS TABLE(bloqueado boolean, segundos_restantes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(i.bloqueado_hasta > now(), false),
    GREATEST(0, CEIL(EXTRACT(epoch FROM (i.bloqueado_hasta - now()))))::integer
  FROM (SELECT 1) AS x
  LEFT JOIN public.intentos_acceso i
    ON i.correo = lower(trim(p_correo));
$$;

CREATE OR REPLACE FUNCTION public.registrar_intento_acceso(
  p_correo text,
  p_exito boolean
)
RETURNS TABLE(bloqueado boolean, intentos_restantes integer, segundos_restantes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c_max_intentos CONSTANT integer := 5;
  c_ventana CONSTANT interval := INTERVAL '15 minutes';
  c_bloqueo CONSTANT interval := INTERVAL '15 minutes';

  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_fila public.intentos_acceso%ROWTYPE;
  v_fallidos integer;
  v_primer timestamptz;
  v_hasta timestamptz;
BEGIN
  IF v_correo = '' THEN
    RAISE EXCEPTION 'Debe indicar el correo.';
  END IF;

  IF p_exito THEN
    DELETE FROM public.intentos_acceso WHERE correo = v_correo;
    RETURN QUERY SELECT false, c_max_intentos, 0;
    RETURN;
  END IF;

  SELECT * INTO v_fila
  FROM public.intentos_acceso
  WHERE correo = v_correo
  FOR UPDATE;

  -- Ya bloqueada: no se cuenta de nuevo ni se alarga el bloqueo.
  IF FOUND AND v_fila.bloqueado_hasta > now() THEN
    RETURN QUERY SELECT
      true,
      0,
      CEIL(EXTRACT(epoch FROM (v_fila.bloqueado_hasta - now())))::integer;
    RETURN;
  END IF;

  -- La cuenta empieza de cero si no hay fallos recientes o si ya
  -- cumplió un bloqueo anterior.
  IF NOT FOUND
     OR v_fila.primer_fallo IS NULL
     OR v_fila.primer_fallo < now() - c_ventana
     OR v_fila.bloqueado_hasta IS NOT NULL THEN
    v_fallidos := 1;
    v_primer := now();
  ELSE
    v_fallidos := v_fila.fallidos + 1;
    v_primer := v_fila.primer_fallo;
  END IF;

  v_hasta := CASE WHEN v_fallidos >= c_max_intentos THEN now() + c_bloqueo END;

  INSERT INTO public.intentos_acceso (
    correo, fallidos, primer_fallo, ultimo_fallo, bloqueado_hasta, updated_at
  )
  VALUES (
    v_correo, v_fallidos, v_primer, now(), v_hasta, now()
  )
  ON CONFLICT (correo) DO UPDATE SET
    fallidos = excluded.fallidos,
    primer_fallo = excluded.primer_fallo,
    ultimo_fallo = excluded.ultimo_fallo,
    bloqueado_hasta = excluded.bloqueado_hasta,
    updated_at = now();

  IF v_hasta IS NOT NULL THEN
    INSERT INTO public.eventos_seguridad (evento, correo, detalle)
    VALUES (
      'bloqueo',
      v_correo,
      v_fallidos || ' intentos fallidos seguidos; bloqueada hasta las ' ||
        to_char(v_hasta AT TIME ZONE 'America/Managua', 'HH24:MI') || ' (hora de Managua)'
    );

    RETURN QUERY SELECT true, 0, CEIL(EXTRACT(epoch FROM c_bloqueo))::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, c_max_intentos - v_fallidos, 0;
END;
$$;

ALTER FUNCTION public.estado_bloqueo_acceso(text) OWNER TO postgres;
ALTER FUNCTION public.registrar_intento_acceso(text, boolean) OWNER TO postgres;
-- Internas: solo las usa intentar_acceso().
REVOKE ALL ON FUNCTION public.estado_bloqueo_acceso(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_intento_acceso(text, boolean) FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------
-- 4b. INTENTO DE ACCESO (lo llaman los dos logins antes de iniciar
-- sesión). Comprueba la contraseña contra el hash de Supabase Auth
-- (bcrypt), cuenta los fallos y bloquea; solo si "permitido" es true
-- el navegador inicia sesión con Supabase Auth. Devuelve el mismo
-- resultado exista o no el correo, para no revelar qué cuentas hay.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.intentar_acceso(p_correo text, p_clave text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'auth'
AS $$
DECLARE
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_hash text;
  v_ok boolean;
  r record;
BEGIN
  IF v_correo = '' OR coalesce(p_clave, '') = '' THEN
    RETURN jsonb_build_object(
      'permitido', false, 'bloqueado', false,
      'intentos_restantes', null, 'segundos_restantes', 0
    );
  END IF;

  SELECT * INTO r FROM public.estado_bloqueo_acceso(v_correo);

  IF r.bloqueado THEN
    RETURN jsonb_build_object(
      'permitido', false, 'bloqueado', true,
      'intentos_restantes', 0, 'segundos_restantes', r.segundos_restantes
    );
  END IF;

  SELECT u.encrypted_password
  INTO v_hash
  FROM auth.users u
  WHERE lower(u.email) = v_correo
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF coalesce(v_hash, '') = '' THEN
    -- Correo inexistente: se calcula un hash igual para que tarde lo mismo.
    PERFORM extensions.crypt(p_clave, extensions.gen_salt('bf', 10));
    v_ok := false;
  ELSE
    v_ok := extensions.crypt(p_clave, v_hash) = v_hash;
  END IF;

  SELECT * INTO r FROM public.registrar_intento_acceso(v_correo, v_ok);

  RETURN jsonb_build_object(
    'permitido', v_ok,
    'bloqueado', r.bloqueado,
    'intentos_restantes', r.intentos_restantes,
    'segundos_restantes', r.segundos_restantes
  );
END;
$$;

ALTER FUNCTION public.intentar_acceso(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.intentar_acceso(text, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.intentar_acceso(text, text) TO anon, authenticated;


-- ---------------------------------------------------------
-- 5. CUENTAS BLOQUEADAS (SOPORTE TI)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cuentas_bloqueadas()
RETURNS TABLE(
  correo text,
  nombre text,
  tipo text,
  fallidos integer,
  bloqueado_hasta timestamptz,
  ultimo_fallo timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'Solo Soporte TI puede consultar las cuentas bloqueadas.';
  END IF;

  RETURN QUERY
  SELECT
    i.correo,
    COALESCE(p.nombre_completo, c.nombre, '—')::text,
    CASE
      WHEN p.id IS NOT NULL THEN 'Personal'
      WHEN c.id IS NOT NULL THEN 'Cliente de la tienda'
      ELSE 'Sin cuenta registrada'
    END::text,
    i.fallidos,
    i.bloqueado_hasta,
    i.ultimo_fallo
  FROM public.intentos_acceso i
  LEFT JOIN public.profiles p
    ON lower(p.correo) = i.correo
  LEFT JOIN public.clientes_web c
    ON lower(c.correo) = i.correo
  WHERE i.bloqueado_hasta > now()
  ORDER BY i.bloqueado_hasta DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.desbloquear_cuenta(p_correo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_correo text := lower(trim(coalesce(p_correo, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'Solo Soporte TI puede desbloquear cuentas.';
  END IF;

  DELETE FROM public.intentos_acceso
  WHERE correo = v_correo
    AND bloqueado_hasta > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no está bloqueada.', v_correo;
  END IF;

  INSERT INTO public.eventos_seguridad (evento, correo, detalle, realizado_por)
  VALUES ('desbloqueo', v_correo, 'Desbloqueada manualmente por Soporte TI', auth.uid());
END;
$$;

ALTER FUNCTION public.cuentas_bloqueadas() OWNER TO postgres;
ALTER FUNCTION public.desbloquear_cuenta(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cuentas_bloqueadas() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.desbloquear_cuenta(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cuentas_bloqueadas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.desbloquear_cuenta(text) TO authenticated;


-- ---------------------------------------------------------
-- 6. AUDITORÍA: rama "Seguridad"
-- Definición vigente con los eventos de bloqueo y desbloqueo.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auditoria_sistema(p_limite integer DEFAULT 300)
 RETURNS TABLE(fecha timestamp with time zone, modulo text, accion text, referencia text, detalle text, usuario text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar la auditoría.';
  END IF;

  RETURN QUERY
  WITH eventos AS (
    SELECT
      a.created_at AS fecha,
      'Usuarios'::text AS modulo,
      CASE a.accion
        WHEN 'crear_usuario' THEN 'Usuario creado'
        WHEN 'actualizar_usuario' THEN 'Usuario modificado'
        WHEN 'restablecer_clave' THEN 'Contraseña restablecida'
        ELSE a.accion
      END AS accion,
      COALESCE(pa.nombre_completo, pa.correo, 'Usuario eliminado') AS referencia,
      a.descripcion AS detalle,
      a.realizado_por AS actor
    FROM public.auditoria_usuarios a
    LEFT JOIN public.profiles pa
      ON pa.id = a.usuario_id

    UNION ALL

    SELECT
      v.anulada_at,
      'Ventas',
      'Venta anulada',
      v.numero,
      v.motivo_anulacion,
      v.anulada_por
    FROM public.ventas v
    WHERE v.estado = 'anulada'
      AND v.anulada_at IS NOT NULL

    UNION ALL

    SELECT
      d.updated_at,
      'Ventas',
      'Devolución anulada',
      d.numero,
      d.observaciones,
      NULL::uuid
    FROM public.devoluciones_venta d
    WHERE d.estado = 'anulada'

    UNION ALL

    SELECT
      c.autorizada_at,
      'Compras',
      'Compra autorizada',
      c.numero,
      'Total C$' || trim(to_char(c.total, 'FM999999990.00')),
      c.autorizada_por
    FROM public.compras c
    WHERE c.autorizada_at IS NOT NULL

    UNION ALL

    SELECT
      c.anulada_at,
      'Compras',
      'Compra anulada',
      c.numero,
      c.motivo_anulacion,
      c.anulada_por
    FROM public.compras c
    WHERE c.estado = 'anulada'
      AND c.anulada_at IS NOT NULL

    UNION ALL

    SELECT
      a.created_at,
      'Caja',
      'Diferencia en arqueo',
      s.numero,
      'Diferencia C$' || trim(to_char(a.diferencia, 'FM999999990.00')),
      a.realizado_por
    FROM public.arqueos_caja a
    JOIN public.sesiones_caja s
      ON s.id = a.sesion_caja_id
    WHERE a.diferencia <> 0

    UNION ALL

    -- Movimientos registrados manualmente (sin documento de origen).
    SELECT
      m.created_at,
      'Inventario',
      'Movimiento manual: ' || replace(m.tipo, '_', ' '),
      pr.codigo,
      pr.nombre || ' · ' ||
        trim(to_char(m.cantidad_anterior, 'FM999999990.##')) || ' → ' ||
        trim(to_char(m.cantidad_nueva, 'FM999999990.##')) ||
        COALESCE(' · ' || m.motivo, ''),
      m.creado_por
    FROM public.movimientos_inventario m
    JOIN public.productos pr
      ON pr.id = m.producto_id
    WHERE m.venta_id IS NULL
      AND m.recepcion_compra_id IS NULL
      AND m.devolucion_compra_id IS NULL
      AND m.devolucion_venta_id IS NULL

    UNION ALL

    -- Cambios de precio de venta o descuento (actualizar_precio_producto).
    SELECT
      h.created_at,
      'Productos',
      'Precio actualizado',
      pr.codigo,
      pr.nombre || ' · C$' ||
        trim(to_char(h.precio_venta_anterior, 'FM999999990.00')) || ' → C$' ||
        trim(to_char(h.precio_venta_nuevo, 'FM999999990.00')) ||
        CASE
          WHEN h.descuento_anterior <> h.descuento_nuevo THEN
            ' · descuento ' ||
            trim(to_char(h.descuento_anterior, 'FM990.##')) || ' % → ' ||
            trim(to_char(h.descuento_nuevo, 'FM990.##')) || ' %'
          ELSE ''
        END ||
        CASE
          WHEN h.descuento_nuevo > 0
           AND h.descuento_hasta_nuevo IS DISTINCT FROM h.descuento_hasta_anterior THEN
            ' · válido hasta ' ||
            COALESCE(to_char(h.descuento_hasta_nuevo, 'DD/MM/YYYY'), 'sin fecha')
          ELSE ''
        END ||
        COALESCE(' · ' || h.motivo, ''),
      h.cambiado_por
    FROM public.historial_precios h
    JOIN public.productos pr
      ON pr.id = h.producto_id

    UNION ALL

    -- Seguridad: bloqueos por intentos fallidos y desbloqueos.
    SELECT
      s.created_at,
      'Seguridad',
      CASE s.evento WHEN 'bloqueo' THEN 'Cuenta bloqueada' ELSE 'Cuenta desbloqueada' END,
      s.correo,
      s.detalle,
      s.realizado_por
    FROM public.eventos_seguridad s
  )
  SELECT
    e.fecha,
    e.modulo,
    e.accion,
    e.referencia,
    e.detalle,
    COALESCE(
      pu.nombre_completo,
      pu.correo,
      CASE WHEN e.modulo = 'Seguridad' THEN 'Sistema (automático)' ELSE '—' END
    )
  FROM eventos e
  LEFT JOIN public.profiles pu
    ON pu.id = e.actor
  ORDER BY e.fecha DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 300), 1000));
END;
$function$;

COMMIT;
