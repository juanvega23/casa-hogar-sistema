-- =========================================================
-- SOPORTE TI · USUARIOS INTERNOS, AUDITORÍA Y AJUSTES
--
--  1. profiles.correo y handle_new_user()
--  2. auditoria_usuarios
--  3. listar_usuarios_internos() / actualizar_usuario_interno()
--  4. auditoria_sistema() / resumen_sistema_soporte()
--  5. reportes_propietario(): también Gerencia y Administración
--  6. anular_compra(): Responsable de Compras
--  7. Políticas SELECT redundantes
--  8. Cuentas por cobrar vencidas
--  9. unidad_medida sincronizada con unidad_medida_id
--
-- La creación de cuentas y el cambio de contraseña requieren la
-- service_role, que NUNCA se usa en React: los realiza la Edge
-- Function 'gestionar-usuarios', que valida el rol soporte_ti.
-- =========================================================

BEGIN;


-- =========================================================
-- 1. CORREO EN PROFILES
-- auth.users no es legible desde el cliente; se copia el correo
-- para poder listar y buscar usuarios internos.
-- =========================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS correo text;

UPDATE public.profiles p
SET correo = u.email
FROM auth.users u
WHERE u.id = p.id
  AND p.correo IS DISTINCT FROM u.email;


-- Igual que la versión vigente, más el correo del perfil interno.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tipo text;
  v_nombre text;
BEGIN
  v_tipo := lower(trim(coalesce(
    new.raw_user_meta_data ->> 'account_type',
    'personal'
  )));

  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuario'), '@', 1)
  );

  IF v_tipo = 'cliente_web' THEN
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


-- =========================================================
-- 2. AUDITORÍA DE GESTIÓN DE USUARIOS
-- Sin políticas: se consulta con auditoria_sistema() y se
-- escribe solo desde funciones SECURITY DEFINER o la Edge
-- Function (service_role).
-- =========================================================

CREATE TABLE IF NOT EXISTS public.auditoria_usuarios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accion text NOT NULL,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  descripcion text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  realizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditoria_usuarios_accion_check CHECK (
    accion IN ('crear_usuario', 'actualizar_usuario', 'restablecer_clave')
  )
);

ALTER TABLE public.auditoria_usuarios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auditoria_usuarios FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_auditoria_usuarios_fecha
ON public.auditoria_usuarios (created_at DESC);


-- La base revoca los privilegios por defecto también a
-- service_role (que ignora RLS, pero no los GRANT). Se concede
-- solo lo que usa la Edge Function 'gestionar-usuarios'.
GRANT SELECT ON TABLE public.roles TO service_role;
GRANT SELECT ON TABLE public.profiles TO service_role;
GRANT UPDATE (role_id, nombre_completo, correo) ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.clientes_web TO service_role;
GRANT SELECT, INSERT ON TABLE public.auditoria_usuarios TO service_role;


-- =========================================================
-- 3. GESTIÓN DE USUARIOS INTERNOS
-- =========================================================

CREATE OR REPLACE FUNCTION public.listar_usuarios_internos()
RETURNS TABLE (
  id uuid,
  nombre_completo text,
  correo text,
  role_id bigint,
  rol_codigo text,
  rol_nombre text,
  activo boolean,
  ultimo_acceso timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'No tiene permisos para administrar usuarios.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.nombre_completo,
    COALESCE(p.correo, u.email)::text,
    p.role_id,
    r.codigo,
    r.nombre,
    p.activo,
    u.last_sign_in_at,
    p.created_at
  FROM public.profiles p
  LEFT JOIN public.roles r
    ON r.id = p.role_id
  LEFT JOIN auth.users u
    ON u.id = p.id
  ORDER BY p.activo DESC, p.nombre_completo;
END;
$$;

ALTER FUNCTION public.listar_usuarios_internos() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.listar_usuarios_internos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_usuarios_internos() TO authenticated;


CREATE OR REPLACE FUNCTION public.actualizar_usuario_interno(
  p_usuario_id uuid,
  p_nombre text,
  p_role_id bigint,
  p_activo boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_actor uuid;
  v_perfil record;
  v_rol_anterior text;
  v_rol_nuevo text;
  v_nombre text;
  v_cambios text[] := ARRAY[]::text[];
BEGIN
  v_actor := auth.uid();

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'No tiene permisos para administrar usuarios.';
  END IF;

  SELECT p.id, p.nombre_completo, p.role_id, p.activo
  INTO v_perfil
  FROM public.profiles p
  WHERE p.id = p_usuario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario interno indicado no existe.';
  END IF;

  v_nombre := NULLIF(TRIM(COALESCE(p_nombre, '')), '');

  IF v_nombre IS NULL OR LENGTH(v_nombre) < 2 THEN
    RAISE EXCEPTION 'El nombre debe tener al menos 2 caracteres.';
  END IF;

  IF p_role_id IS NULL THEN
    RAISE EXCEPTION 'Debe asignar un rol al usuario.';
  END IF;

  SELECT r.nombre
  INTO v_rol_nuevo
  FROM public.roles r
  WHERE r.id = p_role_id
    AND r.activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El rol seleccionado no existe o está inactivo.';
  END IF;

  -- Evita que Soporte TI se bloquee a sí mismo.
  IF p_usuario_id = v_actor
     AND (
       p_activo IS DISTINCT FROM true
       OR p_role_id IS DISTINCT FROM v_perfil.role_id
     )
  THEN
    RAISE EXCEPTION 'No puede desactivarse ni cambiar su propio rol.';
  END IF;

  SELECT r.nombre
  INTO v_rol_anterior
  FROM public.roles r
  WHERE r.id = v_perfil.role_id;

  IF v_nombre IS DISTINCT FROM v_perfil.nombre_completo THEN
    v_cambios := v_cambios || format('nombre: %s → %s', COALESCE(v_perfil.nombre_completo, '—'), v_nombre);
  END IF;

  IF p_role_id IS DISTINCT FROM v_perfil.role_id THEN
    v_cambios := v_cambios || format('rol: %s → %s', COALESCE(v_rol_anterior, 'sin rol'), v_rol_nuevo);
  END IF;

  IF p_activo IS DISTINCT FROM v_perfil.activo THEN
    v_cambios := v_cambios || CASE WHEN p_activo THEN 'reactivado' ELSE 'desactivado' END;
  END IF;

  IF array_length(v_cambios, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET
    nombre_completo = v_nombre,
    role_id = p_role_id,
    activo = COALESCE(p_activo, false)
  WHERE id = p_usuario_id;

  INSERT INTO public.auditoria_usuarios (
    accion,
    usuario_id,
    descripcion,
    detalle,
    realizado_por
  )
  VALUES (
    'actualizar_usuario',
    p_usuario_id,
    array_to_string(v_cambios, '; '),
    jsonb_build_object(
      'antes', jsonb_build_object(
        'nombre', v_perfil.nombre_completo,
        'role_id', v_perfil.role_id,
        'activo', v_perfil.activo
      ),
      'despues', jsonb_build_object(
        'nombre', v_nombre,
        'role_id', p_role_id,
        'activo', COALESCE(p_activo, false)
      )
    ),
    v_actor
  );
END;
$$;

ALTER FUNCTION public.actualizar_usuario_interno(uuid, text, bigint, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.actualizar_usuario_interno(uuid, text, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_usuario_interno(uuid, text, bigint, boolean) TO authenticated;


-- =========================================================
-- 4. AUDITORÍA Y ESTADO DEL SISTEMA (SOPORTE TI)
--
-- La auditoría reúne la trazabilidad que ya registran los
-- módulos (anulaciones, autorizaciones, diferencias de caja,
-- ajustes manuales de inventario) más la gestión de usuarios.
-- =========================================================

CREATE OR REPLACE FUNCTION public.auditoria_sistema(
  p_limite integer DEFAULT 300
)
RETURNS TABLE (
  fecha timestamptz,
  modulo text,
  accion text,
  referencia text,
  detalle text,
  usuario text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
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
  )
  SELECT
    e.fecha,
    e.modulo,
    e.accion,
    e.referencia,
    e.detalle,
    COALESCE(pu.nombre_completo, pu.correo, '—')
  FROM eventos e
  LEFT JOIN public.profiles pu
    ON pu.id = e.actor
  ORDER BY e.fecha DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 300), 1000));
END;
$$;

ALTER FUNCTION public.auditoria_sistema(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auditoria_sistema(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_sistema(integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.resumen_sistema_soporte()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'soporte_ti' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el estado del sistema.';
  END IF;

  SELECT jsonb_build_object(
    'generado_en', now(),

    'usuarios', jsonb_build_object(
      'activos', (SELECT count(*) FROM public.profiles WHERE activo AND role_id IS NOT NULL),
      'inactivos', (SELECT count(*) FROM public.profiles WHERE NOT activo),
      'sin_rol', (SELECT count(*) FROM public.profiles WHERE activo AND role_id IS NULL)
    ),

    'por_rol', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'codigo', r.codigo,
          'nombre', r.nombre,
          'activos', (
            SELECT count(*)
            FROM public.profiles p
            WHERE p.role_id = r.id
              AND p.activo
          )
        )
        ORDER BY r.nombre
      )
      FROM public.roles r
      WHERE r.activo
    ), '[]'::jsonb),

    'clientes_web', jsonb_build_object(
      'total', (SELECT count(*) FROM public.clientes_web),
      'activos', (SELECT count(*) FROM public.clientes_web WHERE activo)
    ),

    'catalogo', jsonb_build_object(
      'productos_activos', (SELECT count(*) FROM public.productos WHERE activo),
      'con_imagen', (SELECT count(*) FROM public.productos WHERE activo AND imagen_url IS NOT NULL)
    ),

    'servicios', jsonb_build_object(
      'bucket_productos', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'productos'),
      'tareas_programadas', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    )
  )
  INTO v_resultado;

  RETURN v_resultado;
END;
$$;

ALTER FUNCTION public.resumen_sistema_soporte() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resumen_sistema_soporte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_sistema_soporte() TO authenticated;


-- =========================================================
-- 5. REPORTES: GERENCIA Y ADMINISTRACIÓN
-- Mismo contenido de solo consulta que el Propietario. El
-- dashboard y las alertas siguen siendo exclusivos del
-- Propietario.
-- =========================================================

CREATE OR REPLACE FUNCTION "public"."reportes_propietario"("p_desde" "date", "p_hasta" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_desde date;
  v_hasta date;

  v_ventas_total numeric(14,2) := 0;
  v_ventas_operaciones bigint := 0;
  v_ventas_ticket_promedio numeric(14,2) := 0;
  v_ganancia_bruta numeric(14,2) := 0;
  v_margen_bruto numeric(8,2) := 0;
  v_ventas_contado numeric(14,2) := 0;
  v_ventas_credito numeric(14,2) := 0;
  v_cxc_pendiente numeric(14,2) := 0;
  v_cxc_vencida numeric(14,2) := 0;

  v_compras_total numeric(14,2) := 0;
  v_compras_operaciones bigint := 0;
  v_compras_promedio numeric(14,2) := 0;
  v_compras_registradas bigint := 0;
  v_compras_autorizadas bigint := 0;
  v_compras_recibidas bigint := 0;

  v_productos_activos bigint := 0;
  v_stock_unidades numeric(14,2) := 0;
  v_valor_inventario_costo numeric(14,2) := 0;
  v_valor_inventario_venta numeric(14,2) := 0;
  v_stock_bajo bigint := 0;
  v_agotados bigint := 0;
  v_entradas_periodo numeric(14,2) := 0;
  v_salidas_periodo numeric(14,2) := 0;

  v_sesiones_caja bigint := 0;
  v_sesiones_cerradas bigint := 0;
  v_sesiones_abiertas bigint := 0;
  v_ingresos_caja numeric(14,2) := 0;
  v_egresos_caja numeric(14,2) := 0;
  v_diferencia_caja numeric(14,2) := 0;
  v_sesiones_con_diferencia bigint := 0;

  v_tendencia_ventas jsonb := '[]'::jsonb;
  v_top_productos jsonb := '[]'::jsonb;
  v_ultimas_ventas jsonb := '[]'::jsonb;
  v_ultimas_compras jsonb := '[]'::jsonb;
  v_stock_critico jsonb := '[]'::jsonb;
  v_jornadas_caja jsonb := '[]'::jsonb;
BEGIN
  -- ----------------------------------------------------------
  -- SEGURIDAD
  -- ----------------------------------------------------------
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'propietario',
    'gerencia',
    'administracion'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos para consultar reportes ejecutivos.';
  END IF;

  v_desde := COALESCE(
    p_desde,
    date_trunc('month', CURRENT_DATE)::date
  );

  v_hasta := COALESCE(
    p_hasta,
    CURRENT_DATE
  );

  IF v_desde > v_hasta THEN
    RAISE EXCEPTION 'La fecha inicial no puede ser posterior a la fecha final.';
  END IF;


  -- ----------------------------------------------------------
  -- VENTAS
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(v.total), 0),
    COUNT(*),
    COALESCE(AVG(v.total), 0),
    COALESCE(SUM(v.total) FILTER (WHERE v.tipo_venta = 'contado'), 0),
    COALESCE(SUM(v.total) FILTER (WHERE v.tipo_venta = 'credito'), 0)
  INTO
    v_ventas_total,
    v_ventas_operaciones,
    v_ventas_ticket_promedio,
    v_ventas_contado,
    v_ventas_credito
  FROM public.ventas v
  WHERE v.estado <> 'anulada'
    AND v.created_at >= v_desde::timestamptz
    AND v.created_at < (v_hasta + 1)::timestamptz;

  SELECT
    COALESCE(
      SUM(
        d.subtotal
        - (
          COALESCE(d.costo_unitario, 0)
          * d.cantidad
        )
      ),
      0
    )
  INTO v_ganancia_bruta
  FROM public.detalle_ventas d
  JOIN public.ventas v
    ON v.id = d.venta_id
  WHERE v.estado <> 'anulada'
    AND v.created_at >= v_desde::timestamptz
    AND v.created_at < (v_hasta + 1)::timestamptz;

  IF v_ventas_total > 0 THEN
    v_margen_bruto :=
      ROUND(
        (v_ganancia_bruta / v_ventas_total) * 100,
        2
      );
  END IF;

  SELECT
    COALESCE(SUM(c.saldo_pendiente), 0),
    COALESCE(
      SUM(c.saldo_pendiente) FILTER (
        WHERE c.fecha_vencimiento < CURRENT_DATE
      ),
      0
    )
  INTO
    v_cxc_pendiente,
    v_cxc_vencida
  FROM public.cuentas_por_cobrar c
  WHERE c.saldo_pendiente > 0;


  -- Tendencia diaria de ventas.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'fecha', x.fecha,
          'total', x.total,
          'operaciones', x.operaciones
        )
        ORDER BY x.fecha
      ),
      '[]'::jsonb
    )
  INTO v_tendencia_ventas
  FROM (
    SELECT
      d.fecha::date AS fecha,
      COALESCE(SUM(v.total), 0)::numeric(14,2) AS total,
      COUNT(v.id)::bigint AS operaciones
    FROM generate_series(
      v_desde::timestamp,
      v_hasta::timestamp,
      INTERVAL '1 day'
    ) AS d(fecha)
    LEFT JOIN public.ventas v
      ON v.created_at::date = d.fecha::date
      AND v.estado <> 'anulada'
    GROUP BY d.fecha::date
  ) x;


  -- Productos más vendidos del período.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'producto_id', x.producto_id,
          'nombre', x.nombre,
          'cantidad', x.cantidad,
          'monto', x.monto
        )
        ORDER BY x.cantidad DESC, x.monto DESC
      ),
      '[]'::jsonb
    )
  INTO v_top_productos
  FROM (
    SELECT
      p.id AS producto_id,
      p.nombre,
      SUM(d.cantidad)::numeric(14,2) AS cantidad,
      SUM(d.subtotal)::numeric(14,2) AS monto
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    JOIN public.productos p
      ON p.id = d.producto_id
    WHERE v.estado <> 'anulada'
      AND v.created_at >= v_desde::timestamptz
      AND v.created_at < (v_hasta + 1)::timestamptz
    GROUP BY p.id, p.nombre
    ORDER BY
      SUM(d.cantidad) DESC,
      SUM(d.subtotal) DESC
    LIMIT 10
  ) x;


  -- Últimas ventas del período.
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'numero', x.numero,
          'fecha', x.created_at,
          'cliente', x.cliente_nombre,
          'tipo', x.tipo_venta,
          'estado', x.estado,
          'total', x.total
        )
        ORDER BY x.created_at DESC
      ),
      '[]'::jsonb
    )
  INTO v_ultimas_ventas
  FROM (
    SELECT
      v.numero,
      v.created_at,
      v.cliente_nombre,
      v.tipo_venta,
      v.estado,
      v.total
    FROM public.ventas v
    WHERE v.estado <> 'anulada'
      AND v.created_at >= v_desde::timestamptz
      AND v.created_at < (v_hasta + 1)::timestamptz
    ORDER BY v.created_at DESC
    LIMIT 10
  ) x;


  -- ----------------------------------------------------------
  -- COMPRAS
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(c.total), 0),
    COUNT(*),
    COALESCE(AVG(c.total), 0),
    COUNT(*) FILTER (WHERE c.estado = 'registrada'),
    COUNT(*) FILTER (WHERE c.estado = 'autorizada'),
    COUNT(*) FILTER (WHERE c.estado = 'recibida')
  INTO
    v_compras_total,
    v_compras_operaciones,
    v_compras_promedio,
    v_compras_registradas,
    v_compras_autorizadas,
    v_compras_recibidas
  FROM public.compras c
  WHERE c.estado <> 'anulada'
    AND c.fecha_compra BETWEEN v_desde AND v_hasta;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'numero', x.numero,
          'fecha', x.fecha_compra,
          'estado', x.estado,
          'tipo', x.tipo_compra,
          'proveedor', x.proveedor,
          'total', x.total
        )
        ORDER BY x.fecha_compra DESC, x.numero DESC
      ),
      '[]'::jsonb
    )
  INTO v_ultimas_compras
  FROM (
    SELECT
      c.numero,
      c.fecha_compra,
      c.estado,
      c.tipo_compra,
      p.nombre AS proveedor,
      c.total
    FROM public.compras c
    JOIN public.proveedores p
      ON p.id = c.proveedor_id
    WHERE c.estado <> 'anulada'
      AND c.fecha_compra BETWEEN v_desde AND v_hasta
    ORDER BY c.fecha_compra DESC, c.id DESC
    LIMIT 10
  ) x;


  -- ----------------------------------------------------------
  -- INVENTARIO
  -- Estado actual + movimientos del período.
  -- ----------------------------------------------------------
  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(e.cantidad, 0)), 0),
    COALESCE(
      SUM(
        COALESCE(e.cantidad, 0)
        * p.precio_compra
      ),
      0
    ),
    COALESCE(
      SUM(
        COALESCE(e.cantidad, 0)
        * p.precio_venta
      ),
      0
    ),
    COUNT(*) FILTER (
      WHERE COALESCE(e.cantidad, 0) > 0
        AND COALESCE(e.cantidad, 0) <= p.stock_minimo
    ),
    COUNT(*) FILTER (
      WHERE COALESCE(e.cantidad, 0) <= 0
    )
  INTO
    v_productos_activos,
    v_stock_unidades,
    v_valor_inventario_costo,
    v_valor_inventario_venta,
    v_stock_bajo,
    v_agotados
  FROM public.productos p
  LEFT JOIN public.existencias e
    ON e.producto_id = p.id
  WHERE p.activo = true;

  SELECT
    COALESCE(
      SUM(m.cantidad) FILTER (
        WHERE m.tipo IN ('entrada', 'ajuste_positivo')
      ),
      0
    ),
    COALESCE(
      SUM(m.cantidad) FILTER (
        WHERE m.tipo IN ('salida', 'ajuste_negativo')
      ),
      0
    )
  INTO
    v_entradas_periodo,
    v_salidas_periodo
  FROM public.movimientos_inventario m
  WHERE m.created_at >= v_desde::timestamptz
    AND m.created_at < (v_hasta + 1)::timestamptz;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'producto_id', x.producto_id,
          'codigo', x.codigo,
          'nombre', x.nombre,
          'existencia', x.existencia,
          'stock_minimo', x.stock_minimo,
          'estado', x.estado
        )
        ORDER BY
          CASE x.estado
            WHEN 'agotado' THEN 1
            ELSE 2
          END,
          x.existencia ASC,
          x.nombre
      ),
      '[]'::jsonb
    )
  INTO v_stock_critico
  FROM (
    SELECT
      p.id AS producto_id,
      p.codigo,
      p.nombre,
      COALESCE(e.cantidad, 0)::numeric(14,2) AS existencia,
      p.stock_minimo::numeric(14,2) AS stock_minimo,
      CASE
        WHEN COALESCE(e.cantidad, 0) <= 0
          THEN 'agotado'
        ELSE 'stock_bajo'
      END AS estado
    FROM public.productos p
    LEFT JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.activo = true
      AND COALESCE(e.cantidad, 0) <= p.stock_minimo
    ORDER BY
      COALESCE(e.cantidad, 0) ASC,
      p.nombre
    LIMIT 15
  ) x;


  -- ----------------------------------------------------------
  -- CAJA
  -- ----------------------------------------------------------
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE s.estado = 'cerrada'),
    COUNT(*) FILTER (WHERE s.estado = 'abierta')
  INTO
    v_sesiones_caja,
    v_sesiones_cerradas,
    v_sesiones_abiertas
  FROM public.sesiones_caja s
  WHERE s.fecha_apertura >= v_desde::timestamptz
    AND s.fecha_apertura < (v_hasta + 1)::timestamptz;

  SELECT
    COALESCE(
      SUM(m.monto) FILTER (
        WHERE m.tipo = 'ingreso'
      ),
      0
    ),
    COALESCE(
      SUM(m.monto) FILTER (
        WHERE m.tipo = 'egreso'
      ),
      0
    )
  INTO
    v_ingresos_caja,
    v_egresos_caja
  FROM public.movimientos_caja m
  WHERE m.created_at >= v_desde::timestamptz
    AND m.created_at < (v_hasta + 1)::timestamptz;

  SELECT
    COALESCE(SUM(a.diferencia), 0),
    COUNT(*) FILTER (
      WHERE a.diferencia <> 0
    )
  INTO
    v_diferencia_caja,
    v_sesiones_con_diferencia
  FROM public.arqueos_caja a
  JOIN public.sesiones_caja s
    ON s.id = a.sesion_caja_id
  WHERE s.fecha_apertura >= v_desde::timestamptz
    AND s.fecha_apertura < (v_hasta + 1)::timestamptz;

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'numero', x.numero,
          'apertura', x.fecha_apertura,
          'cierre', x.fecha_cierre,
          'estado', x.estado,
          'monto_inicial', x.monto_inicial,
          'diferencia', x.diferencia
        )
        ORDER BY x.fecha_apertura DESC
      ),
      '[]'::jsonb
    )
  INTO v_jornadas_caja
  FROM (
    SELECT
      s.numero,
      s.fecha_apertura,
      s.fecha_cierre,
      s.estado,
      s.monto_inicial,
      a.diferencia
    FROM public.sesiones_caja s
    LEFT JOIN public.arqueos_caja a
      ON a.sesion_caja_id = s.id
    WHERE s.fecha_apertura >= v_desde::timestamptz
      AND s.fecha_apertura < (v_hasta + 1)::timestamptz
    ORDER BY s.fecha_apertura DESC
    LIMIT 10
  ) x;


  -- ----------------------------------------------------------
  -- RESULTADO
  -- ----------------------------------------------------------
  RETURN jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'generado_en', now(),

    'ventas',
    jsonb_build_object(
      'total', ROUND(v_ventas_total, 2),
      'operaciones', v_ventas_operaciones,
      'ticket_promedio', ROUND(v_ventas_ticket_promedio, 2),
      'ganancia_bruta', ROUND(v_ganancia_bruta, 2),
      'margen_bruto_pct', ROUND(v_margen_bruto, 2),
      'contado', ROUND(v_ventas_contado, 2),
      'credito', ROUND(v_ventas_credito, 2),
      'cxc_pendiente', ROUND(v_cxc_pendiente, 2),
      'cxc_vencida', ROUND(v_cxc_vencida, 2),
      'tendencia', v_tendencia_ventas,
      'top_productos', v_top_productos,
      'ultimas_ventas', v_ultimas_ventas
    ),

    'compras',
    jsonb_build_object(
      'total', ROUND(v_compras_total, 2),
      'operaciones', v_compras_operaciones,
      'promedio', ROUND(v_compras_promedio, 2),
      'registradas', v_compras_registradas,
      'autorizadas', v_compras_autorizadas,
      'recibidas', v_compras_recibidas,
      'ultimas_compras', v_ultimas_compras
    ),

    'inventario',
    jsonb_build_object(
      'productos_activos', v_productos_activos,
      'stock_unidades', ROUND(v_stock_unidades, 2),
      'valor_costo', ROUND(v_valor_inventario_costo, 2),
      'valor_venta', ROUND(v_valor_inventario_venta, 2),
      'stock_bajo', v_stock_bajo,
      'agotados', v_agotados,
      'entradas_periodo', ROUND(v_entradas_periodo, 2),
      'salidas_periodo', ROUND(v_salidas_periodo, 2),
      'stock_critico', v_stock_critico
    ),

    'caja',
    jsonb_build_object(
      'sesiones', v_sesiones_caja,
      'cerradas', v_sesiones_cerradas,
      'abiertas', v_sesiones_abiertas,
      'ingresos', ROUND(v_ingresos_caja, 2),
      'egresos', ROUND(v_egresos_caja, 2),
      'saldo_movimientos', ROUND(v_ingresos_caja - v_egresos_caja, 2),
      'diferencia_acumulada', ROUND(v_diferencia_caja, 2),
      'sesiones_con_diferencia', v_sesiones_con_diferencia,
      'jornadas', v_jornadas_caja
    )
  );
END;
$$;


-- =========================================================
-- 6. ANULAR COMPRA: RESPONSABLE DE COMPRAS
-- Quien revisa la orden puede rechazarla mientras no haya
-- sido recibida. Gerencia queda como rol de consulta, como en
-- el resto del sistema. Se mantiene Administración.
-- =========================================================

CREATE OR REPLACE FUNCTION public.anular_compra(
  p_compra_id bigint,
  p_motivo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_rol text;
  v_compra record;
BEGIN
  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_compras',
    'administracion'
  ) THEN
    RAISE EXCEPTION
      'Solo el Responsable de Compras o Administración pueden anular una compra.';
  END IF;

  IF p_motivo IS NULL
     OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION
      'Debe indicar un motivo válido para anular la compra.';
  END IF;

  SELECT
    c.id,
    c.numero,
    c.estado
  INTO v_compra
  FROM public.compras c
  WHERE c.id = p_compra_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La compra indicada no existe.';
  END IF;

  IF v_compra.estado = 'anulada' THEN
    RAISE EXCEPTION
      'La compra % ya se encuentra anulada.',
      v_compra.numero;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.recepciones_compra rc
    WHERE rc.compra_id = p_compra_id
  ) THEN
    RAISE EXCEPTION
      'La compra % ya tiene una recepción registrada. Debe gestionarse mediante una devolución de compra.',
      v_compra.numero;
  END IF;

  UPDATE public.compras
  SET
    estado = 'anulada',
    motivo_anulacion = trim(p_motivo),
    anulada_por = auth.uid(),
    anulada_at = now()
  WHERE id = p_compra_id;
END;
$$;


-- =========================================================
-- 7. POLÍTICAS SELECT REDUNDANTES
-- Cada una es un subconjunto exacto de otra política de la
-- misma tabla (las políticas permisivas se combinan con OR),
-- así que eliminarlas no cambia ningún acceso.
-- =========================================================

DROP POLICY IF EXISTS movimientos_caja_select_responsable ON public.movimientos_caja;
DROP POLICY IF EXISTS pagos_venta_select_caja ON public.pagos_venta;
DROP POLICY IF EXISTS sesiones_caja_select_caja ON public.sesiones_caja;
DROP POLICY IF EXISTS cuentas_por_cobrar_select_caja ON public.cuentas_por_cobrar;


-- =========================================================
-- 8. CUENTAS POR COBRAR VENCIDAS
-- Ningún proceso marcaba 'vencida'. Se actualiza ahora y, si
-- pg_cron está disponible, todos los días a las 00:15 de
-- Managua (06:15 UTC).
-- =========================================================

CREATE OR REPLACE FUNCTION public.actualizar_cuentas_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actualizadas integer;
BEGIN
  -- Solo cambia 'estado': no dispara trg_validar_limite_credito,
  -- que vigila saldo_pendiente.
  UPDATE public.cuentas_por_cobrar
  SET
    estado = 'vencida',
    updated_at = now()
  WHERE estado = 'pendiente'
    AND saldo_pendiente > 0
    AND fecha_vencimiento < CURRENT_DATE;

  GET DIAGNOSTICS v_actualizadas = ROW_COUNT;

  RETURN v_actualizadas;
END;
$$;

ALTER FUNCTION public.actualizar_cuentas_vencidas() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.actualizar_cuentas_vencidas() FROM PUBLIC, anon, authenticated;

SELECT public.actualizar_cuentas_vencidas();

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

    PERFORM cron.schedule(
      'casa_hogar_cuentas_vencidas',
      '15 6 * * *',
      'SELECT public.actualizar_cuentas_vencidas()'
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron no disponible; las cuentas vencidas se actualizarán al ejecutar actualizar_cuentas_vencidas(): %', SQLERRM;
  END;
END;
$$;


-- =========================================================
-- 9. UNIDAD DE MEDIDA SINCRONIZADA
-- Las validaciones de cantidades enteras usan el texto
-- productos.unidad_medida; el catálogo usa unidad_medida_id.
-- Este trigger mantiene ambos iguales aunque el producto se
-- edite por otra vía.
-- =========================================================

CREATE OR REPLACE FUNCTION public.sincronizar_unidad_medida_producto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nombre text;
BEGIN
  IF NEW.unidad_medida_id IS NOT NULL THEN
    SELECT um.nombre
    INTO v_nombre
    FROM public.unidades_medida um
    WHERE um.id = NEW.unidad_medida_id;

    IF FOUND THEN
      NEW.unidad_medida := v_nombre;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sincronizar_unidad_medida_producto() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_productos_sincronizar_unidad ON public.productos;

CREATE TRIGGER trg_productos_sincronizar_unidad
BEFORE INSERT OR UPDATE OF unidad_medida_id, unidad_medida
ON public.productos
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_unidad_medida_producto();

UPDATE public.productos p
SET unidad_medida = um.nombre
FROM public.unidades_medida um
WHERE um.id = p.unidad_medida_id
  AND p.unidad_medida IS DISTINCT FROM um.nombre;

COMMIT;
