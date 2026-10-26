-- =========================================================
-- ESQUEMA BASE · SISTEMA CASA HOGAR
--
-- Volcado del esquema "public" de la base remota (26/10/2026),
-- que reemplaza a las migraciones 001-025 como punto de partida.
-- Esas migraciones se conservan en supabase/migraciones_historicas
-- como referencia; NO se vuelven a ejecutar.
--
-- Motivo: ventas, caja, propietario, tienda web y varios roles se
-- crearon directamente en el SQL Editor, por lo que la cadena
-- 001-025 no podía reconstruir la base desde cero.
--
-- Al final se agrega lo que pg_dump no incluye porque vive en
-- esquemas gestionados por Supabase (auth, storage) o es dato:
--   · trigger on_auth_user_created
--   · catálogo de roles
--   · bucket 'productos' y sus políticas
--
-- Nuevos cambios: crear migraciones con `supabase migration new`.
-- =========================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."abrir_caja"("p_monto_inicial" numeric DEFAULT 0, "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("sesion_id" bigint, "numero" "text", "estado" "text", "fecha_apertura" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_sesion_id bigint;
  v_numero text;
  v_fecha_apertura timestamptz;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_caja',
    'ventas'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para abrir caja.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR MONTO INICIAL
  -- ==========================================================

  IF p_monto_inicial IS NULL THEN
    p_monto_inicial := 0;
  END IF;


  IF p_monto_inicial < 0 THEN
    RAISE EXCEPTION
      'El monto inicial de caja no puede ser negativo.';
  END IF;


  p_monto_inicial :=
    ROUND(
      p_monto_inicial,
      2
    );


  -- ==========================================================
  -- 4. IMPEDIR DOS SESIONES ABIERTAS
  -- ==========================================================

  IF EXISTS (
    SELECT 1
    FROM public.sesiones_caja s
    WHERE s.abierta_por = v_usuario
      AND s.estado = 'abierta'
  ) THEN
    RAISE EXCEPTION
      'El responsable ya posee una sesión de caja abierta.';
  END IF;


  -- ==========================================================
  -- 5. GENERAR NÚMERO
  -- ==========================================================

  v_numero :=
    'CAJ-' ||
    LPAD(
      NEXTVAL(
        'public.sesion_caja_numero_seq'
      )::text,
      6,
      '0'
    );


  -- ==========================================================
  -- 6. CREAR SESIÓN
  -- ==========================================================

  INSERT INTO public.sesiones_caja (
    numero,
    abierta_por,
    monto_inicial,
    estado,
    observaciones_apertura
  )
  VALUES (
    v_numero,
    v_usuario,
    p_monto_inicial,
    'abierta',
    NULLIF(
      TRIM(
        COALESCE(
          p_observaciones,
          ''
        )
      ),
      ''
    )
  )
  RETURNING
    id,
    sesiones_caja.fecha_apertura
  INTO
    v_sesion_id,
    v_fecha_apertura;


  -- ==========================================================
  -- 7. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_sesion_id,
    v_numero,
    'abierta'::text,
    v_fecha_apertura;

END;
$$;


ALTER FUNCTION "public"."abrir_caja"("p_monto_inicial" numeric, "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_costos_recepcion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_costo numeric(14,2);
  v_proveedor_id bigint;
BEGIN
  SELECT
    dc.costo_unitario,
    c.proveedor_id
  INTO
    v_costo,
    v_proveedor_id
  FROM public.recepciones_compra rc
  JOIN public.compras c
    ON c.id = rc.compra_id
  JOIN public.detalle_compras dc
    ON dc.compra_id = c.id
   AND dc.producto_id = NEW.producto_id
  WHERE rc.id = NEW.recepcion_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.productos
  SET precio_compra = v_costo
  WHERE id = NEW.producto_id
    AND precio_compra IS DISTINCT FROM v_costo;

  INSERT INTO public.proveedor_productos (
    proveedor_id,
    producto_id,
    ultimo_costo,
    activo
  )
  VALUES (
    v_proveedor_id,
    NEW.producto_id,
    v_costo,
    true
  )
  ON CONFLICT (proveedor_id, producto_id) DO UPDATE
  SET
    ultimo_costo = EXCLUDED.ultimo_costo,
    activo = true,
    updated_at = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."actualizar_costos_recepcion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alertas_recomendaciones_propietario"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_alertas jsonb := '[]'::jsonb;

  v_criticas bigint := 0;
  v_altas bigint := 0;
  v_medias bigint := 0;
  v_bajas bigint := 0;

  v_reposicion_total numeric(14,2) := 0;
BEGIN
  -- ----------------------------------------------------------
  -- SEGURIDAD
  -- ----------------------------------------------------------
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'propietario' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar alertas y recomendaciones.';
  END IF;


  -- ----------------------------------------------------------
  -- CONSTRUIR CENTRO DE DECISIONES
  -- ----------------------------------------------------------
  WITH
  ventas_30d AS (
    SELECT
      d.producto_id,
      COALESCE(SUM(d.cantidad), 0)::numeric(14,2) AS unidades_30d
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    WHERE v.estado <> 'anulada'
      AND v.created_at >= now() - INTERVAL '30 days'
    GROUP BY d.producto_id
  ),

  ultima_venta_producto AS (
    SELECT
      d.producto_id,
      MAX(v.created_at) AS ultima_venta
    FROM public.detalle_ventas d
    JOIN public.ventas v
      ON v.id = d.venta_id
    WHERE v.estado <> 'anulada'
    GROUP BY d.producto_id
  ),

  proveedores_producto AS (
    SELECT
      pp.producto_id,
      COUNT(*) FILTER (
        WHERE pp.activo = true
      )::bigint AS proveedores,
      MIN(pp.ultimo_costo) FILTER (
        WHERE pp.activo = true
          AND pp.ultimo_costo IS NOT NULL
      )::numeric(14,2) AS mejor_costo
    FROM public.proveedor_productos pp
    GROUP BY pp.producto_id
  ),

  inventario_alertas AS (
    SELECT
      'inventario'::text AS tipo,
      CASE
        WHEN COALESCE(e.cantidad, 0) <= 0
          THEN 'critica'
        ELSE 'alta'
      END::text AS prioridad,
      now() AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      p.id::text AS referencia_id,
      p.codigo::text AS referencia,

      CASE
        WHEN COALESCE(e.cantidad, 0) <= 0
          THEN 'Producto agotado'
        ELSE 'Stock bajo'
      END::text AS titulo,

      CASE
        WHEN COALESCE(e.cantidad, 0) <= 0
          THEN
            p.nombre ||
            ' no tiene unidades disponibles.'
        ELSE
            p.nombre ||
            ' tiene ' ||
            trim(to_char(COALESCE(e.cantidad, 0), 'FM999999990.##')) ||
            ' unidades y su mínimo es ' ||
            trim(to_char(p.stock_minimo, 'FM999999990.##')) ||
            '.'
      END::text AS mensaje,

      CASE
        WHEN COALESCE(e.cantidad, 0) <= 0
          THEN
            'Reponer el producto antes de nuevas ventas. Cantidad sugerida: ' ||
            trim(
              to_char(
                GREATEST(
                  0,
                  COALESCE(
                    p.stock_maximo,
                    GREATEST(
                      p.stock_minimo * 2,
                      p.stock_minimo +
                      CEIL(
                        COALESCE(v30.unidades_30d, 0) / 2
                      )
                    )
                  ) - COALESCE(e.cantidad, 0)
                ),
                'FM999999990.##'
              )
            ) ||
            ' unidades.'
        ELSE
            'Planificar reposición. Cantidad sugerida: ' ||
            trim(
              to_char(
                GREATEST(
                  0,
                  COALESCE(
                    p.stock_maximo,
                    GREATEST(
                      p.stock_minimo * 2,
                      p.stock_minimo +
                      CEIL(
                        COALESCE(v30.unidades_30d, 0) / 2
                      )
                    )
                  ) - COALESCE(e.cantidad, 0)
                ),
                'FM999999990.##'
              )
            ) ||
            ' unidades.'
      END::text AS recomendacion,

      GREATEST(
        0,
        COALESCE(
          p.stock_maximo,
          GREATEST(
            p.stock_minimo * 2,
            p.stock_minimo +
            CEIL(
              COALESCE(v30.unidades_30d, 0) / 2
            )
          )
        ) - COALESCE(e.cantidad, 0)
      )::numeric(14,2) AS cantidad_sugerida,

      COALESCE(pr.proveedores, 0)::bigint AS proveedores_disponibles,
      pr.mejor_costo,

      COALESCE(e.cantidad, 0)::numeric(14,2) AS existencia_actual,
      p.stock_minimo::numeric(14,2) AS stock_minimo,
      COALESCE(v30.unidades_30d, 0)::numeric(14,2) AS movimiento_30d

    FROM public.productos p
    LEFT JOIN public.existencias e
      ON e.producto_id = p.id
    LEFT JOIN ventas_30d v30
      ON v30.producto_id = p.id
    LEFT JOIN proveedores_producto pr
      ON pr.producto_id = p.id
    WHERE p.activo = true
      AND COALESCE(e.cantidad, 0) <= p.stock_minimo
  ),

  baja_rotacion AS (
    SELECT
      'inventario'::text AS tipo,
      'media'::text AS prioridad,
      now() AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      p.id::text AS referencia_id,
      p.codigo::text AS referencia,

      'Producto de baja rotación'::text AS titulo,

      (
        p.nombre ||
        ' mantiene ' ||
        trim(to_char(COALESCE(e.cantidad, 0), 'FM999999990.##')) ||
        ' unidades y no registra ventas en los últimos 60 días.'
      )::text AS mensaje,

      'Revisar precio, promoción, exhibición o necesidad de mantener este nivel de inventario.'::text
        AS recomendacion,

      0::numeric(14,2) AS cantidad_sugerida,
      COALESCE(pr.proveedores, 0)::bigint AS proveedores_disponibles,
      pr.mejor_costo,

      COALESCE(e.cantidad, 0)::numeric(14,2) AS existencia_actual,
      p.stock_minimo::numeric(14,2) AS stock_minimo,
      COALESCE(v30.unidades_30d, 0)::numeric(14,2) AS movimiento_30d

    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    LEFT JOIN ventas_30d v30
      ON v30.producto_id = p.id
    LEFT JOIN ultima_venta_producto uv
      ON uv.producto_id = p.id
    LEFT JOIN proveedores_producto pr
      ON pr.producto_id = p.id
    WHERE p.activo = true
      AND e.cantidad > p.stock_minimo
      AND (
        uv.ultima_venta IS NULL
        OR uv.ultima_venta < now() - INTERVAL '60 days'
      )
  ),

  cartera_alertas AS (
    SELECT
      'cartera'::text AS tipo,
      CASE
        WHEN CURRENT_DATE - c.fecha_vencimiento >= 30
          THEN 'critica'
        ELSE 'alta'
      END::text AS prioridad,
      now() AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      c.id::text AS referencia_id,
      v.numero::text AS referencia,

      'Cuenta por cobrar vencida'::text AS titulo,

      (
        'La venta ' ||
        v.numero ||
        ' tiene un saldo vencido de C$' ||
        trim(to_char(c.saldo_pendiente, 'FM999999990.00')) ||
        ' desde el ' ||
        to_char(c.fecha_vencimiento, 'DD/MM/YYYY') ||
        '.'
      )::text AS mensaje,

      'Dar seguimiento a la recuperación de cartera y revisar nuevas ventas a crédito del cliente.'::text
        AS recomendacion,

      0::numeric(14,2) AS cantidad_sugerida,
      0::bigint AS proveedores_disponibles,
      NULL::numeric(14,2) AS mejor_costo,

      0::numeric(14,2) AS existencia_actual,
      0::numeric(14,2) AS stock_minimo,
      0::numeric(14,2) AS movimiento_30d

    FROM public.cuentas_por_cobrar c
    JOIN public.ventas v
      ON v.id = c.venta_id
    WHERE c.saldo_pendiente > 0
      AND c.fecha_vencimiento < CURRENT_DATE
  ),

  pedidos_alertas AS (
    SELECT
      'ventas'::text AS tipo,
      CASE
        WHEN p.created_at < now() - INTERVAL '2 days'
          THEN 'alta'
        ELSE 'media'
      END::text AS prioridad,
      now() AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      p.id::text AS referencia_id,
      p.numero::text AS referencia,

      'Pedido en línea pendiente'::text AS titulo,

      (
        'El pedido ' ||
        p.numero ||
        ' de ' ||
        p.cliente_nombre ||
        ' continúa en estado ' ||
        replace(p.estado, '_', ' ') ||
        '.'
      )::text AS mensaje,

      CASE
        WHEN p.created_at < now() - INTERVAL '2 days'
          THEN 'Revisar por qué el pedido no ha avanzado y dar seguimiento comercial.'
        ELSE 'Mantener seguimiento hasta convertir, rechazar o cancelar el pedido.'
      END::text AS recomendacion,

      0::numeric(14,2) AS cantidad_sugerida,
      0::bigint AS proveedores_disponibles,
      NULL::numeric(14,2) AS mejor_costo,

      0::numeric(14,2) AS existencia_actual,
      0::numeric(14,2) AS stock_minimo,
      0::numeric(14,2) AS movimiento_30d

    FROM public.pedidos_en_linea p
    WHERE p.estado IN (
      'recibido',
      'confirmado',
      'preparado'
    )
  ),

  caja_alertas AS (
    SELECT
      'caja'::text AS tipo,
      CASE
        WHEN ABS(a.diferencia) >= 500
          THEN 'critica'
        ELSE 'alta'
      END::text AS prioridad,
      a.created_at AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      a.id::text AS referencia_id,
      s.numero::text AS referencia,

      'Diferencia en arqueo de caja'::text AS titulo,

      (
        'La jornada ' ||
        s.numero ||
        ' registró una diferencia de C$' ||
        trim(to_char(a.diferencia, 'FM999999990.00')) ||
        '.'
      )::text AS mensaje,

      'Revisar los movimientos, cobros, egresos y efectivo contabilizado de la jornada.'::text
        AS recomendacion,

      0::numeric(14,2) AS cantidad_sugerida,
      0::bigint AS proveedores_disponibles,
      NULL::numeric(14,2) AS mejor_costo,

      0::numeric(14,2) AS existencia_actual,
      0::numeric(14,2) AS stock_minimo,
      0::numeric(14,2) AS movimiento_30d

    FROM public.arqueos_caja a
    JOIN public.sesiones_caja s
      ON s.id = a.sesion_caja_id
    WHERE a.diferencia <> 0
      AND a.created_at >= now() - INTERVAL '90 days'
  ),

  compras_alertas AS (
    SELECT
      'compras'::text AS tipo,
      CASE
        WHEN c.autorizada_at < now() - INTERVAL '5 days'
          THEN 'alta'
        ELSE 'media'
      END::text AS prioridad,
      COALESCE(c.autorizada_at, c.created_at) AS fecha,
      'activa'::text AS estado,
      'propietario'::text AS destinatario_rol,

      c.id::text AS referencia_id,
      c.numero::text AS referencia,

      'Compra autorizada pendiente de recepción'::text AS titulo,

      (
        'La compra ' ||
        c.numero ||
        ' por C$' ||
        trim(to_char(c.total, 'FM999999990.00')) ||
        ' aún no ha sido recibida.'
      )::text AS mensaje,

      'Dar seguimiento a la recepción para evitar retrasos en la reposición del inventario.'::text
        AS recomendacion,

      0::numeric(14,2) AS cantidad_sugerida,
      0::bigint AS proveedores_disponibles,
      NULL::numeric(14,2) AS mejor_costo,

      0::numeric(14,2) AS existencia_actual,
      0::numeric(14,2) AS stock_minimo,
      0::numeric(14,2) AS movimiento_30d

    FROM public.compras c
    WHERE c.estado = 'autorizada'
  ),

  todas AS (
    SELECT * FROM inventario_alertas
    UNION ALL
    SELECT * FROM baja_rotacion
    UNION ALL
    SELECT * FROM cartera_alertas
    UNION ALL
    SELECT * FROM pedidos_alertas
    UNION ALL
    SELECT * FROM caja_alertas
    UNION ALL
    SELECT * FROM compras_alertas
  ),

  ordenadas AS (
    SELECT *
    FROM todas
    ORDER BY
      CASE prioridad
        WHEN 'critica' THEN 1
        WHEN 'alta' THEN 2
        WHEN 'media' THEN 3
        ELSE 4
      END,
      fecha DESC,
      titulo
  )

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'tipo', o.tipo,
          'prioridad', o.prioridad,
          'fecha', o.fecha,
          'estado', o.estado,
          'destinatario_rol', o.destinatario_rol,

          'referencia_id', o.referencia_id,
          'referencia', o.referencia,

          'titulo', o.titulo,
          'mensaje', o.mensaje,
          'recomendacion', o.recomendacion,

          'cantidad_sugerida', o.cantidad_sugerida,
          'proveedores_disponibles', o.proveedores_disponibles,
          'mejor_costo', o.mejor_costo,

          'existencia_actual', o.existencia_actual,
          'stock_minimo', o.stock_minimo,
          'movimiento_30d', o.movimiento_30d
        )
      ),
      '[]'::jsonb
    )
  INTO v_alertas
  FROM ordenadas o;


  -- ----------------------------------------------------------
  -- RESUMEN
  -- ----------------------------------------------------------
  SELECT
    COUNT(*) FILTER (
      WHERE x ->> 'prioridad' = 'critica'
    ),
    COUNT(*) FILTER (
      WHERE x ->> 'prioridad' = 'alta'
    ),
    COUNT(*) FILTER (
      WHERE x ->> 'prioridad' = 'media'
    ),
    COUNT(*) FILTER (
      WHERE x ->> 'prioridad' = 'baja'
    ),
    COALESCE(
      SUM(
        COALESCE(
          NULLIF(
            x ->> 'cantidad_sugerida',
            ''
          )::numeric,
          0
        )
      ),
      0
    )
  INTO
    v_criticas,
    v_altas,
    v_medias,
    v_bajas,
    v_reposicion_total
  FROM jsonb_array_elements(v_alertas) x;


  RETURN jsonb_build_object(
    'generado_en', now(),

    'resumen',
    jsonb_build_object(
      'total',
        jsonb_array_length(v_alertas),
      'criticas', v_criticas,
      'altas', v_altas,
      'medias', v_medias,
      'bajas', v_bajas,
      'reposicion_sugerida_total',
        ROUND(v_reposicion_total, 2)
    ),

    'alertas',
    v_alertas
  );
END;
$_$;


ALTER FUNCTION "public"."alertas_recomendaciones_propietario"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_compra"("p_compra_id" bigint, "p_motivo" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_rol text;
  v_compra record;
begin

  -- ==========================================================
  -- 1. VALIDAR AUTORIZACIÓN
  -- ==========================================================

  v_rol := public.current_role_code();

  if coalesce(v_rol, '') not in (
    'administracion',
    'gerencia'
  ) then
    raise exception
      'Solo Administración o Gerencia pueden anular una compra.';
  end if;


  -- ==========================================================
  -- 2. VALIDAR MOTIVO
  -- ==========================================================

  if p_motivo is null
     or length(trim(p_motivo)) < 3 then
    raise exception
      'Debe indicar un motivo válido para anular la compra.';
  end if;


  -- ==========================================================
  -- 3. OBTENER Y BLOQUEAR COMPRA
  -- ==========================================================

  select
    c.id,
    c.numero,
    c.estado
  into v_compra
  from public.compras c
  where c.id = p_compra_id
  for update;


  if not found then
    raise exception
      'La compra indicada no existe.';
  end if;


  if v_compra.estado = 'anulada' then
    raise exception
      'La compra % ya se encuentra anulada.',
      v_compra.numero;
  end if;


  -- ==========================================================
  -- 4. NO ANULAR COMPRAS YA RECIBIDAS
  -- ==========================================================

  if exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = p_compra_id
  ) then
    raise exception
      'La compra % ya tiene una recepción registrada. Debe gestionarse mediante una devolución de compra.',
      v_compra.numero;
  end if;


  -- ==========================================================
  -- 5. ANULAR COMPRA
  -- ==========================================================

  update public.compras
  set
    estado = 'anulada',
    motivo_anulacion = trim(p_motivo),
    anulada_por = auth.uid(),
    anulada_at = now()
  where id = p_compra_id;

end;
$$;


ALTER FUNCTION "public"."anular_compra"("p_compra_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_devolucion_venta"("p_devolucion_id" bigint, "p_motivo" "text") RETURNS TABLE("devolucion_id" bigint, "numero" "text", "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;
  v_devolucion record;
BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_comercial'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para anular devoluciones de venta.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR MOTIVO
  -- ==========================================================

  IF p_motivo IS NULL
     OR LENGTH(TRIM(p_motivo)) < 3
  THEN
    RAISE EXCEPTION
      'Debe indicar un motivo válido para anular la devolución.';
  END IF;


  -- ==========================================================
  -- 4. OBTENER Y BLOQUEAR DEVOLUCIÓN
  -- ==========================================================

  SELECT
    d.id,
    d.numero,
    d.estado,
    d.observaciones
  INTO
    v_devolucion
  FROM public.devoluciones_venta d
  WHERE d.id = p_devolucion_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La devolución indicada no existe.';
  END IF;


  -- ==========================================================
  -- 5. SOLO SE PUEDE ANULAR SI ESTÁ REGISTRADA
  -- ==========================================================

  IF v_devolucion.estado <> 'registrada' THEN
    RAISE EXCEPTION
      'La devolución % no puede anularse desde su estado actual (%).',
      v_devolucion.numero,
      v_devolucion.estado;
  END IF;


  -- ==========================================================
  -- 6. ANULAR
  -- ==========================================================

  UPDATE public.devoluciones_venta
  SET
    estado = 'anulada',

    observaciones =
      CONCAT_WS(
        E'\n',
        NULLIF(
          TRIM(
            COALESCE(
              v_devolucion.observaciones,
              ''
            )
          ),
          ''
        ),
        'ANULACIÓN: ' || TRIM(p_motivo)
      ),

    updated_at = NOW()

  WHERE id = p_devolucion_id;


  -- ==========================================================
  -- 7. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_devolucion.id,
    v_devolucion.numero,
    'anulada'::text;

END;
$$;


ALTER FUNCTION "public"."anular_devolucion_venta"("p_devolucion_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text" DEFAULT 'Anulación de venta'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_numero text;
  v_estado text;
  v_tipo_venta text;

  v_detalle record;

  v_existencia_anterior numeric(14,2);
  v_existencia_nueva numeric(14,2);

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_comercial'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para anular ventas.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR MOTIVO
  -- ==========================================================

  IF p_motivo IS NULL
     OR LENGTH(TRIM(p_motivo)) < 3
  THEN
    RAISE EXCEPTION
      'Debe indicar un motivo válido para anular la venta.';
  END IF;


  -- ==========================================================
  -- 4. OBTENER Y BLOQUEAR VENTA
  -- ==========================================================

  SELECT
    v.numero,
    v.estado,
    v.tipo_venta
  INTO
    v_numero,
    v_estado,
    v_tipo_venta
  FROM public.ventas v
  WHERE v.id = p_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta indicada no existe.';
  END IF;


  IF v_estado = 'anulada' THEN
    RAISE EXCEPTION
      'La venta % ya se encuentra anulada.',
      v_numero;
  END IF;


  -- ==========================================================
  -- 5. SOLO VENTAS DE CONTADO PENDIENTES DE COBRO
  -- ==========================================================

  IF v_tipo_venta <> 'contado'
     OR v_estado <> 'pendiente_cobro'
  THEN
    RAISE EXCEPTION
      'La venta % no puede anularse desde su estado actual. Las ventas pagadas o a crédito deben gestionarse mediante el flujo correspondiente.',
      v_numero;
  END IF;


  -- Protección adicional:
  -- una venta pendiente de cobro no debe tener pagos.
  IF EXISTS (
    SELECT 1
    FROM public.pagos_venta pv
    WHERE pv.venta_id = p_venta_id
  ) THEN
    RAISE EXCEPTION
      'La venta % ya posee pagos registrados y no puede anularse directamente.',
      v_numero;
  END IF;


  -- No permitir anulación si ya existe una devolución
  IF EXISTS (
    SELECT 1
    FROM public.devoluciones_venta d
    WHERE d.venta_id = p_venta_id
      AND d.estado IN (
        'registrada',
        'confirmada'
      )
  ) THEN
    RAISE EXCEPTION
      'La venta % posee una devolución asociada y no puede anularse directamente.',
      v_numero;
  END IF;


  -- ==========================================================
  -- 6. RESTAURAR INVENTARIO
  -- ==========================================================

  FOR v_detalle IN
    SELECT
      dv.producto_id,
      dv.cantidad
    FROM public.detalle_ventas dv
    WHERE dv.venta_id = p_venta_id
  LOOP

    SELECT e.cantidad
    INTO v_existencia_anterior
    FROM public.existencias e
    WHERE e.producto_id = v_detalle.producto_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'No existe registro de existencia para el producto %.',
        v_detalle.producto_id;
    END IF;


    v_existencia_nueva :=
      v_existencia_anterior +
      v_detalle.cantidad;


    UPDATE public.existencias
    SET
      cantidad = v_existencia_nueva,
      updated_at = NOW()
    WHERE producto_id = v_detalle.producto_id;


    INSERT INTO public.movimientos_inventario (
      producto_id,
      tipo,
      cantidad,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      referencia,
      venta_id,
      creado_por
    )
    VALUES (
      v_detalle.producto_id,
      'entrada',
      v_detalle.cantidad,
      v_existencia_anterior,
      v_existencia_nueva,
      'Anulación de venta ' || v_numero,
      'ANULACION-' || v_numero,
      p_venta_id,
      v_usuario
    );

  END LOOP;


  -- ==========================================================
  -- 7. MARCAR VENTA COMO ANULADA
  -- ==========================================================

  UPDATE public.ventas
  SET
    estado = 'anulada',
    anulada_at = NOW(),
    anulada_por = v_usuario,
    motivo_anulacion = TRIM(p_motivo),
    updated_at = NOW()
  WHERE id = p_venta_id;

END;
$$;


ALTER FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aplicar_devolucion_financiera"("p_devolucion_id" bigint) RETURNS TABLE("devolucion_id" bigint, "numero" "text", "monto_devolucion" numeric, "monto_aplicado_cxc" numeric, "monto_reembolso" numeric, "saldo_pendiente" numeric, "estado_financiero" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_numero text;
  v_venta_id bigint;
  v_total numeric(14,2);
  v_estado_devolucion text;
  v_estado_financiero_actual text;

  v_tipo_venta text;

  v_cuenta_id bigint;
  v_saldo_anterior numeric(14,2) := 0;
  v_saldo_nuevo numeric(14,2) := 0;
  v_estado_cuenta text;

  v_aplicado_cxc numeric(14,2) := 0;
  v_reembolso numeric(14,2) := 0;
  v_estado_financiero_nuevo text;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO Y ROL
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_caja',
    'ventas'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para procesar financieramente devoluciones.';
  END IF;


  -- ==========================================================
  -- 2. OBTENER Y BLOQUEAR DEVOLUCIÓN
  -- ==========================================================

  SELECT
    d.numero,
    d.venta_id,
    d.total,
    d.estado,
    d.estado_financiero
  INTO
    v_numero,
    v_venta_id,
    v_total,
    v_estado_devolucion,
    v_estado_financiero_actual
  FROM public.devoluciones_venta d
  WHERE d.id = p_devolucion_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La devolución indicada no existe.';
  END IF;


  IF v_estado_devolucion <> 'confirmada' THEN
    RAISE EXCEPTION
      'La devolución % debe estar confirmada antes de procesarse financieramente.',
      v_numero;
  END IF;


  IF v_estado_financiero_actual <> 'pendiente' THEN
    RAISE EXCEPTION
      'La devolución % ya fue procesada financieramente.',
      v_numero;
  END IF;


  IF v_total <= 0 THEN
    RAISE EXCEPTION
      'La devolución % no posee un monto válido.',
      v_numero;
  END IF;


  -- ==========================================================
  -- 3. OBTENER TIPO DE VENTA
  -- ==========================================================

  SELECT v.tipo_venta
  INTO v_tipo_venta
  FROM public.ventas v
  WHERE v.id = v_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No existe la venta asociada a la devolución.';
  END IF;


  -- ==========================================================
  -- 4. SI ES VENTA A CRÉDITO, APLICAR PRIMERO A CxC
  -- ==========================================================

  IF v_tipo_venta = 'credito' THEN

    SELECT
      c.id,
      c.saldo_pendiente,
      c.estado
    INTO
      v_cuenta_id,
      v_saldo_anterior,
      v_estado_cuenta
    FROM public.cuentas_por_cobrar c
    WHERE c.venta_id = v_venta_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'La venta a crédito asociada no posee cuenta por cobrar.';
    END IF;


    v_aplicado_cxc :=
      LEAST(
        v_total,
        v_saldo_anterior
      );


    v_saldo_nuevo :=
      ROUND(
        v_saldo_anterior - v_aplicado_cxc,
        2
      );


    IF v_aplicado_cxc > 0 THEN

      UPDATE public.cuentas_por_cobrar
      SET
        saldo_pendiente = v_saldo_nuevo,
        estado = CASE
          WHEN v_saldo_nuevo = 0
            THEN 'pagada'
          ELSE v_estado_cuenta
        END,
        updated_at = NOW()
      WHERE id = v_cuenta_id;

    END IF;


    -- Si ya no queda deuda pendiente,
    -- la venta deja de estar "con_saldo".
    IF v_saldo_nuevo = 0 THEN

      UPDATE public.ventas
      SET
        estado = 'pagada',
        updated_at = NOW()
      WHERE id = v_venta_id
        AND estado = 'con_saldo';

    END IF;


    v_reembolso :=
      ROUND(
        v_total - v_aplicado_cxc,
        2
      );

  ELSE

    -- Venta de contado:
    -- todo el valor devuelto debe reembolsarse.
    v_aplicado_cxc := 0;
    v_reembolso := v_total;
    v_saldo_nuevo := 0;

  END IF;


  -- ==========================================================
  -- 5. DEFINIR ESTADO FINANCIERO
  -- ==========================================================

  IF v_reembolso > 0 THEN
    v_estado_financiero_nuevo := 'pendiente_reembolso';
  ELSE
    v_estado_financiero_nuevo := 'aplicada_cxc';
  END IF;


  -- ==========================================================
  -- 6. ACTUALIZAR DEVOLUCIÓN
  -- ==========================================================

  UPDATE public.devoluciones_venta
  SET
    estado_financiero = v_estado_financiero_nuevo,
    monto_aplicado_cxc = v_aplicado_cxc,
    monto_reembolso = v_reembolso,
    procesada_financieramente_at = NOW(),
    procesada_financieramente_por = v_usuario,
    updated_at = NOW()
  WHERE id = p_devolucion_id;


  -- ==========================================================
  -- 7. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    p_devolucion_id,
    v_numero,
    v_total,
    v_aplicado_cxc,
    v_reembolso,
    v_saldo_nuevo,
    v_estado_financiero_nuevo;

END;
$$;


ALTER FUNCTION "public"."aplicar_devolucion_financiera"("p_devolucion_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."autorizar_compra"("p_compra_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_rol text;
  v_compra record;
begin

  -- ----------------------------------------------------------
  -- VALIDAR ROL
  -- ----------------------------------------------------------
  -- Permisos provisionales mientras se define la matriz final
  -- de actores y responsabilidades.

  v_rol := public.current_role_code();

  
      if coalesce(v_rol, '') <> 'responsable_compras' then
    
    raise exception
      'No tiene permisos para autorizar compras.';
  end if;


  -- ----------------------------------------------------------
  -- OBTENER COMPRA
  -- ----------------------------------------------------------

  select
    c.id,
    c.numero,
    c.estado
  into v_compra
  from public.compras c
  where c.id = p_compra_id
  for update;


  if not found then
    raise exception
      'La compra indicada no existe.';
  end if;


  -- ----------------------------------------------------------
  -- VALIDAR ESTADO
  -- ----------------------------------------------------------

  if v_compra.estado = 'anulada' then
    raise exception
      'La compra % se encuentra anulada.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'recibida' then
    raise exception
      'La compra % ya fue recibida.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'autorizada' then
    raise exception
      'La compra % ya se encuentra autorizada.',
      v_compra.numero;
  end if;


  if v_compra.estado <> 'registrada' then
    raise exception
      'La compra % no puede autorizarse desde su estado actual.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- AUTORIZAR
  -- ----------------------------------------------------------

  update public.compras
  set
    estado = 'autorizada',
    autorizada_por = auth.uid(),
    autorizada_at = now()
  where id = p_compra_id;

end;
$$;


ALTER FUNCTION "public"."autorizar_compra"("p_compra_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cambiar_estado_pedido_web"("p_pedido_id" bigint, "p_estado" "text", "p_motivo" "text" DEFAULT NULL::"text") RETURNS TABLE("pedido_id" bigint, "numero" "text", "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
  v_rol text;
  v_pedido record;
  v_estado text;
  v_motivo text;
  v_faltante record;
BEGIN

  -- ----------------------------------------------------------
  -- USUARIO Y ROL
  -- ----------------------------------------------------------

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'vendedor',
    'marketing_digital'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos para gestionar pedidos en línea.';
  END IF;


  -- ----------------------------------------------------------
  -- VALIDAR ESTADO SOLICITADO
  -- ----------------------------------------------------------

  v_estado := LOWER(TRIM(COALESCE(p_estado, '')));
  v_motivo := NULLIF(TRIM(COALESCE(p_motivo, '')), '');

  IF v_estado NOT IN (
    'confirmado',
    'preparado',
    'rechazado',
    'cancelado'
  ) THEN
    RAISE EXCEPTION 'Estado de pedido no válido.';
  END IF;

  IF v_estado IN ('rechazado', 'cancelado')
     AND (v_motivo IS NULL OR LENGTH(v_motivo) < 3)
  THEN
    RAISE EXCEPTION 'Debe indicar un motivo válido.';
  END IF;


  -- ----------------------------------------------------------
  -- OBTENER Y BLOQUEAR PEDIDO
  -- ----------------------------------------------------------

  SELECT p.id, p.numero, p.estado
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;


  -- ----------------------------------------------------------
  -- TRANSICIONES PERMITIDAS
  -- ----------------------------------------------------------

  IF NOT (
    (v_pedido.estado = 'recibido'   AND v_estado IN ('confirmado', 'rechazado')) OR
    (v_pedido.estado = 'confirmado' AND v_estado IN ('preparado', 'cancelado')) OR
    (v_pedido.estado = 'preparado'  AND v_estado = 'cancelado')
  ) THEN
    RAISE EXCEPTION
      'El pedido % no puede pasar de % a %.',
      v_pedido.numero,
      v_pedido.estado,
      v_estado;
  END IF;


  -- ----------------------------------------------------------
  -- AL CONFIRMAR: VERIFICAR DISPONIBILIDAD ACTUAL
  -- (el pedido no reserva stock; la salida real ocurre al
  -- convertirlo en venta)
  -- ----------------------------------------------------------

  IF v_estado = 'confirmado' THEN
    SELECT
      pr.nombre,
      SUM(d.cantidad) AS solicitado,
      COALESCE(MAX(e.cantidad), 0) AS disponible
    INTO v_faltante
    FROM public.detalle_pedidos_en_linea d
    JOIN public.productos pr
      ON pr.id = d.producto_id
    LEFT JOIN public.existencias e
      ON e.producto_id = d.producto_id
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id, pr.nombre, pr.activo
    HAVING NOT pr.activo
        OR SUM(d.cantidad) > COALESCE(MAX(e.cantidad), 0)
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'No hay existencia suficiente de %. Disponible: %, solicitado: %.',
        v_faltante.nombre,
        v_faltante.disponible,
        v_faltante.solicitado;
    END IF;
  END IF;


  -- ----------------------------------------------------------
  -- ACTUALIZAR
  -- ----------------------------------------------------------

  UPDATE public.pedidos_en_linea
  SET
    estado = v_estado,
    motivo_estado = CASE
      WHEN v_estado IN ('rechazado', 'cancelado') THEN v_motivo
      ELSE motivo_estado
    END,
    gestionado_por = v_usuario,
    gestionado_at = now()
  WHERE id = p_pedido_id;


  RETURN QUERY
  SELECT
    v_pedido.id::bigint,
    v_pedido.numero::text,
    v_estado;
END;
$$;


ALTER FUNCTION "public"."cambiar_estado_pedido_web"("p_pedido_id" bigint, "p_estado" "text", "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancelar_mi_pedido_web"("p_pedido_id" bigint, "p_motivo" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_pedido record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  SELECT p.id, p.numero, p.estado
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
    AND p.cliente_web_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.estado <> 'recibido' THEN
    RAISE EXCEPTION
      'El pedido % ya está siendo atendido y no puede cancelarse desde la tienda. Comuníquese con Casa Hogar.',
      v_pedido.numero;
  END IF;

  UPDATE public.pedidos_en_linea
  SET
    estado = 'cancelado',
    motivo_estado = COALESCE(
      NULLIF(TRIM(COALESCE(p_motivo, '')), ''),
      'Cancelado por el cliente.'
    ),
    gestionado_por = auth.uid(),
    gestionado_at = now()
  WHERE id = p_pedido_id;
END;
$$;


ALTER FUNCTION "public"."cancelar_mi_pedido_web"("p_pedido_id" bigint, "p_motivo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catalogo_publico"() RETURNS TABLE("id" bigint, "codigo" "text", "nombre" "text", "descripcion" "text", "categoria" "text", "precio" numeric, "disponible" boolean, "imagen_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    p.id,
    p.codigo,
    p.nombre,
    p.descripcion,
    coalesce(c.nombre, 'General') AS categoria,
    round(
      p.precio_venta *
      (1 - coalesce(p.descuento_porcentaje, 0) / 100),
      2
    ) AS precio,
    coalesce(e.cantidad, 0) > 0 AS disponible,
    p.imagen_url
  FROM public.productos p
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  LEFT JOIN public.existencias e ON e.producto_id = p.id
  WHERE p.activo = true
  ORDER BY c.nombre NULLS LAST, p.nombre;
$$;


ALTER FUNCTION "public"."catalogo_publico"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cerrar_caja"("p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("sesion_id" bigint, "numero" "text", "ingresos" numeric, "egresos" numeric, "saldo_jornada" numeric, "diferencia" numeric, "fecha_cierre" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;
  v_sesion public.sesiones_caja%ROWTYPE;
  v_ingresos numeric(14,2);
  v_egresos numeric(14,2);
  v_saldo numeric(14,2);
  v_diferencia numeric(14,2);
  v_fecha_cierre timestamptz;
BEGIN
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'No tiene permisos para cerrar caja.';
  END IF;

  SELECT s.*
  INTO v_sesion
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  ORDER BY s.fecha_apertura DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe una sesión de caja abierta.';
  END IF;

  SELECT a.diferencia
  INTO v_diferencia
  FROM public.arqueos_caja a
  WHERE a.sesion_caja_id = v_sesion.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debe realizar el arqueo antes de cerrar la caja.';
  END IF;

  SELECT
    coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso'), 0),
    coalesce(sum(m.monto) FILTER (WHERE m.tipo = 'egreso'), 0)
  INTO
    v_ingresos,
    v_egresos
  FROM public.movimientos_caja m
  WHERE m.sesion_caja_id = v_sesion.id;

  v_saldo := round(
    coalesce(v_sesion.monto_inicial, 0)
    + coalesce(v_ingresos, 0)
    - coalesce(v_egresos, 0),
    2
  );

  v_fecha_cierre := now();

  UPDATE public.sesiones_caja
  SET
    estado = 'cerrada',
    fecha_cierre = v_fecha_cierre,
    cerrada_por = v_usuario,
    observaciones_cierre =
      nullif(trim(coalesce(p_observaciones, '')), ''),
    updated_at = now()
  WHERE id = v_sesion.id;

  RETURN QUERY
  SELECT
    v_sesion.id,
    v_sesion.numero,
    round(v_ingresos, 2),
    round(v_egresos, 2),
    v_saldo,
    round(v_diferencia, 2),
    v_fecha_cierre;
END;
$$;


ALTER FUNCTION "public"."cerrar_caja"("p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cobrar_venta"("p_venta_id" bigint, "p_metodo_pago" "text", "p_monto_recibido" numeric DEFAULT NULL::numeric, "p_referencia" "text" DEFAULT NULL::"text") RETURNS TABLE("pago_id" bigint, "venta_id" bigint, "numero_venta" "text", "total" numeric, "cambio" numeric, "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_sesion_id bigint;

  v_numero_venta text;
  v_total numeric(14,2);
  v_estado text;
  v_tipo_venta text;

  v_metodo_pago text;
  v_monto_recibido numeric(14,2);
  v_cambio numeric(14,2) := 0;

  v_pago_id bigint;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO Y ROL
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_caja',
    'ventas'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para cobrar ventas.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR QUE TENGA CAJA ABIERTA
  -- ==========================================================

  SELECT s.id
  INTO v_sesion_id
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Debe abrir una sesión de caja antes de registrar cobros.';
  END IF;


  -- ==========================================================
  -- 3. OBTENER Y BLOQUEAR VENTA
  -- ==========================================================

  SELECT
    v.numero,
    v.total,
    v.estado,
    v.tipo_venta
  INTO
    v_numero_venta,
    v_total,
    v_estado,
    v_tipo_venta
  FROM public.ventas v
  WHERE v.id = p_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta indicada no existe.';
  END IF;


  -- Solo ventas de contado.
  -- Las ventas a crédito se manejarán mediante abonos.
  IF v_tipo_venta <> 'contado' THEN
    RAISE EXCEPTION
      'Las ventas a crédito deben cobrarse mediante el proceso de abonos.';
  END IF;


  IF v_estado <> 'pendiente_cobro' THEN
    RAISE EXCEPTION
      'La venta % no puede cobrarse desde su estado actual (%).',
      v_numero_venta,
      v_estado;
  END IF;


  -- Protección adicional
  IF EXISTS (
    SELECT 1
    FROM public.pagos_venta pv
    WHERE pv.venta_id = p_venta_id
  ) THEN
    RAISE EXCEPTION
      'La venta % ya posee un pago registrado.',
      v_numero_venta;
  END IF;


  -- ==========================================================
  -- 4. VALIDAR MÉTODO DE PAGO
  -- ==========================================================

  v_metodo_pago :=
    LOWER(
      TRIM(
        COALESCE(
          p_metodo_pago,
          ''
        )
      )
    );


  IF v_metodo_pago NOT IN (
    'efectivo',
    'tarjeta',
    'transferencia'
  ) THEN
    RAISE EXCEPTION
      'El método de pago debe ser efectivo, tarjeta o transferencia.';
  END IF;


  -- ==========================================================
  -- 5. CALCULAR MONTO RECIBIDO Y CAMBIO
  -- ==========================================================

  IF v_metodo_pago = 'efectivo' THEN

    IF p_monto_recibido IS NULL THEN
      RAISE EXCEPTION
        'Debe indicar el monto recibido para pagos en efectivo.';
    END IF;


    v_monto_recibido :=
      ROUND(
        p_monto_recibido,
        2
      );


    IF v_monto_recibido < v_total THEN
      RAISE EXCEPTION
        'Monto recibido insuficiente. Total: %, recibido: %.',
        v_total,
        v_monto_recibido;
    END IF;


    v_cambio :=
      ROUND(
        v_monto_recibido - v_total,
        2
      );

  ELSE

    v_monto_recibido := v_total;
    v_cambio := 0;

  END IF;


  -- ==========================================================
  -- 6. REGISTRAR PAGO
  -- ==========================================================

  INSERT INTO public.pagos_venta (
    venta_id,
    metodo_pago,
    monto,
    monto_recibido,
    cambio,
    referencia,
    creado_por
  )
  VALUES (
    p_venta_id,
    v_metodo_pago,
    v_total,
    v_monto_recibido,
    v_cambio,
    NULLIF(
      TRIM(
        COALESCE(
          p_referencia,
          ''
        )
      ),
      ''
    ),
    v_usuario
  )
  RETURNING id
  INTO v_pago_id;


  -- ==========================================================
  -- 7. REGISTRAR INGRESO EN CAJA
  -- ==========================================================

  INSERT INTO public.movimientos_caja (
    venta_id,
    tipo,
    concepto,
    metodo_pago,
    monto,
    referencia,
    creado_por,
    sesion_caja_id,
    pago_venta_id
  )
  VALUES (
    p_venta_id,
    'ingreso',
    'Cobro de venta ' || v_numero_venta,
    v_metodo_pago,
    v_total,
    COALESCE(
      NULLIF(
        TRIM(
          COALESCE(
            p_referencia,
            ''
          )
        ),
        ''
      ),
      v_numero_venta
    ),
    v_usuario,
    v_sesion_id,
    v_pago_id
  );


  -- ==========================================================
  -- 8. MARCAR VENTA COMO PAGADA
  -- ==========================================================

  UPDATE public.ventas
  SET
    estado = 'pagada',
    updated_at = NOW()
  WHERE id = p_venta_id;


  -- ==========================================================
  -- 9. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_pago_id,
    p_venta_id,
    v_numero_venta,
    v_total,
    v_cambio,
    'pagada'::text;

END;
$$;


ALTER FUNCTION "public"."cobrar_venta"("p_venta_id" bigint, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirmar_devolucion_venta"("p_devolucion_id" bigint, "p_items" "jsonb") RETURNS TABLE("devolucion_id" bigint, "numero" "text", "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_devolucion record;
  v_detalle record;

  v_item jsonb;
  v_producto_id bigint;
  v_destino text;

  v_cantidad_detalles integer;

  v_existencia_anterior numeric(14,2);
  v_existencia_nueva numeric(14,2);

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_comercial'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para confirmar devoluciones de venta.';
  END IF;


  -- ==========================================================
  -- 3. OBTENER Y BLOQUEAR DEVOLUCIÓN
  -- ==========================================================

  SELECT
    d.id,
    d.numero,
    d.venta_id,
    d.estado
  INTO
    v_devolucion
  FROM public.devoluciones_venta d
  WHERE d.id = p_devolucion_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La devolución indicada no existe.';
  END IF;


  IF v_devolucion.estado <> 'registrada' THEN
    RAISE EXCEPTION
      'La devolución % no puede confirmarse desde su estado actual (%).',
      v_devolucion.numero,
      v_devolucion.estado;
  END IF;


  -- ==========================================================
  -- 4. VALIDAR DESTINOS RECIBIDOS
  -- ==========================================================

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION
      'Debe indicar el destino de los productos devueltos.';
  END IF;


  SELECT COUNT(*)
  INTO v_cantidad_detalles
  FROM public.detalle_devoluciones_venta d
  WHERE d.devolucion_id = p_devolucion_id;


  IF v_cantidad_detalles = 0 THEN
    RAISE EXCEPTION
      'La devolución no contiene productos.';
  END IF;


  IF jsonb_array_length(p_items) <> v_cantidad_detalles THEN
    RAISE EXCEPTION
      'Debe indicar el destino de todos los productos de la devolución.';
  END IF;


  -- ==========================================================
  -- 5. VALIDAR FORMATO DE CADA ITEM
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    BEGIN

      v_producto_id :=
        NULLIF(
          v_item ->> 'producto_id',
          ''
        )::bigint;

    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Existe un producto con datos inválidos.';
    END;


    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION
        'Producto inválido.';
    END IF;


    v_destino :=
      LOWER(
        TRIM(
          COALESCE(
            v_item ->> 'destino',
            ''
          )
        )
      );


    IF v_destino NOT IN (
      'inventario',
      'merma'
    ) THEN
      RAISE EXCEPTION
        'El destino del producto % debe ser inventario o merma.',
        v_producto_id;
    END IF;

  END LOOP;


  -- ==========================================================
  -- 6. EVITAR PRODUCTOS REPETIDOS
  -- ==========================================================

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS t(item)
    GROUP BY
      (item ->> 'producto_id')::bigint
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Un producto no puede repetirse al confirmar la devolución.';
  END IF;


  -- ==========================================================
  -- 7. PROCESAR PRODUCTOS
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    v_producto_id :=
      (v_item ->> 'producto_id')::bigint;


    v_destino :=
      LOWER(
        TRIM(
          v_item ->> 'destino'
        )
      );


    -- ----------------------------------------------------------
    -- Obtener y bloquear detalle
    -- ----------------------------------------------------------

    SELECT
      d.id,
      d.producto_id,
      d.cantidad,
      d.destino,
      d.observaciones
    INTO
      v_detalle
    FROM public.detalle_devoluciones_venta d
    WHERE d.devolucion_id = p_devolucion_id
      AND d.producto_id = v_producto_id
    FOR UPDATE;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El producto % no pertenece a la devolución %.',
        v_producto_id,
        v_devolucion.numero;
    END IF;


    -- ----------------------------------------------------------
    -- Guardar destino definitivo
    -- ----------------------------------------------------------

    UPDATE public.detalle_devoluciones_venta
    SET
      destino = v_destino,

      observaciones =
        COALESCE(
          NULLIF(
            TRIM(
              COALESCE(
                v_item ->> 'observaciones',
                ''
              )
            ),
            ''
          ),
          observaciones
        )
    WHERE id = v_detalle.id;


    -- ----------------------------------------------------------
    -- Si vuelve a inventario:
    -- aumentar existencia + registrar Kardex
    -- ----------------------------------------------------------

    IF v_destino = 'inventario' THEN

      SELECT
        e.cantidad
      INTO
        v_existencia_anterior
      FROM public.existencias e
      WHERE e.producto_id = v_producto_id
      FOR UPDATE;


      IF NOT FOUND THEN
        RAISE EXCEPTION
          'No existe registro de existencia para el producto %.',
          v_producto_id;
      END IF;


      v_existencia_nueva :=
        v_existencia_anterior +
        v_detalle.cantidad;


      UPDATE public.existencias
      SET
        cantidad = v_existencia_nueva,
        updated_at = NOW()
      WHERE producto_id = v_producto_id;


      INSERT INTO public.movimientos_inventario (
        producto_id,
        tipo,
        cantidad,
        cantidad_anterior,
        cantidad_nueva,
        motivo,
        referencia,
        creado_por,
        venta_id,
        devolucion_venta_id
      )
      VALUES (
        v_producto_id,
        'entrada',
        v_detalle.cantidad,
        v_existencia_anterior,
        v_existencia_nueva,
        'Devolución de venta ' || v_devolucion.numero,
        v_devolucion.numero,
        v_usuario,
        v_devolucion.venta_id,
        p_devolucion_id
      );

    END IF;


    -- Si destino = merma:
    -- NO aumenta la existencia disponible.
    -- El destino queda registrado en el detalle.

  END LOOP;


  -- ==========================================================
  -- 8. CONFIRMAR DEVOLUCIÓN
  -- ==========================================================

  UPDATE public.devoluciones_venta
  SET
    estado = 'confirmada',
    confirmada_at = NOW(),
    confirmada_por = v_usuario,
    updated_at = NOW()
  WHERE id = p_devolucion_id;


  -- ==========================================================
  -- 9. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_devolucion.id,
    v_devolucion.numero,
    'confirmada'::text;

END;
$$;


ALTER FUNCTION "public"."confirmar_devolucion_venta"("p_devolucion_id" bigint, "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."convertir_pedido_web_en_venta"("p_pedido_id" bigint) RETURNS TABLE("pedido_id" bigint, "venta_id" bigint, "venta_numero" "text", "venta_total" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
  v_rol text;
  v_pedido record;
  v_items jsonb;
  v_venta_id bigint;
  v_venta_numero text;
  v_venta_total numeric(14,2);
BEGIN

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'vendedor' THEN
    RAISE EXCEPTION 'Solo el vendedor puede convertir pedidos en venta.';
  END IF;


  SELECT
    p.id,
    p.numero,
    p.estado,
    p.cliente_id,
    p.cliente_nombre,
    p.venta_id
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.venta_id IS NOT NULL THEN
    RAISE EXCEPTION 'El pedido % ya fue convertido en venta.', v_pedido.numero;
  END IF;

  IF v_pedido.estado NOT IN ('confirmado', 'preparado') THEN
    RAISE EXCEPTION
      'El pedido % debe estar confirmado o preparado para convertirse en venta (estado actual: %).',
      v_pedido.numero,
      v_pedido.estado;
  END IF;


  -- Agrupar por producto: registrar_venta no admite repetidos.
  SELECT jsonb_agg(
    jsonb_build_object(
      'producto_id', x.producto_id,
      'cantidad', x.cantidad
    )
  )
  INTO v_items
  FROM (
    SELECT
      d.producto_id,
      SUM(d.cantidad) AS cantidad
    FROM public.detalle_pedidos_en_linea d
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id
  ) x;

  IF v_items IS NULL THEN
    RAISE EXCEPTION 'El pedido % no contiene productos.', v_pedido.numero;
  END IF;


  SELECT
    r.venta_id,
    r.numero,
    r.total
  INTO
    v_venta_id,
    v_venta_numero,
    v_venta_total
  FROM public.registrar_venta(
    v_items,
    'contado',
    v_pedido.cliente_id,
    v_pedido.cliente_nombre,
    NULL,
    NULL,
    v_pedido.numero
  ) AS r;


  UPDATE public.pedidos_en_linea
  SET
    estado = 'convertido',
    venta_id = v_venta_id,
    gestionado_por = v_usuario,
    gestionado_at = now()
  WHERE id = p_pedido_id;


  RETURN QUERY
  SELECT
    v_pedido.id::bigint,
    v_venta_id,
    v_venta_numero,
    v_venta_total;
END;
$$;


ALTER FUNCTION "public"."convertir_pedido_web_en_venta"("p_pedido_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_existencia_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.existencias (
    producto_id,
    cantidad
  )
  values (
    new.id,
    0
  )
  on conflict (producto_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."crear_existencia_producto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role_code"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.codigo
  from public.profiles p
  join public.roles r
    on r.id = p.role_id
  where p.id = auth.uid()
    and p.activo = true
  limit 1;
$$;


ALTER FUNCTION "public"."current_role_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dashboard_propietario"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_ventas_hoy numeric(14,2) := 0;
  v_ventas_mes numeric(14,2) := 0;
  v_operaciones_mes bigint := 0;

  v_ganancia_bruta_mes numeric(14,2) := 0;
  v_margen_bruto numeric(8,2) := 0;

  v_cxc_pendiente numeric(14,2) := 0;
  v_cxc_vencida numeric(14,2) := 0;
  v_cuentas_vencidas bigint := 0;

  v_compras_mes numeric(14,2) := 0;

  v_stock_bajo bigint := 0;
  v_agotados bigint := 0;

  v_pedidos_pendientes bigint := 0;

  v_ventas_7_dias jsonb := '[]'::jsonb;
  v_top_productos jsonb := '[]'::jsonb;

  v_ultima_caja jsonb := '{}'::jsonb;
BEGIN
  -- ----------------------------------------------------------
  -- SEGURIDAD
  -- ----------------------------------------------------------
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'propietario' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el dashboard del propietario.';
  END IF;


  -- ----------------------------------------------------------
  -- VENTAS
  -- Se excluyen las ventas anuladas.
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(v.total) FILTER (
      WHERE v.created_at::date = CURRENT_DATE
    ), 0),
    COALESCE(SUM(v.total) FILTER (
      WHERE date_trunc('month', v.created_at)
        = date_trunc('month', CURRENT_DATE::timestamp)
    ), 0),
    COUNT(*) FILTER (
      WHERE date_trunc('month', v.created_at)
        = date_trunc('month', CURRENT_DATE::timestamp)
    )
  INTO
    v_ventas_hoy,
    v_ventas_mes,
    v_operaciones_mes
  FROM public.ventas v
  WHERE v.estado <> 'anulada';


  -- ----------------------------------------------------------
  -- GANANCIA BRUTA ESTIMADA DEL MES
  -- Venta neta de cada detalle - costo del producto vendido.
  -- ----------------------------------------------------------
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
  INTO v_ganancia_bruta_mes
  FROM public.detalle_ventas d
  JOIN public.ventas v
    ON v.id = d.venta_id
  WHERE v.estado <> 'anulada'
    AND date_trunc('month', v.created_at)
      = date_trunc('month', CURRENT_DATE::timestamp);

  IF v_ventas_mes > 0 THEN
    v_margen_bruto :=
      ROUND(
        (v_ganancia_bruta_mes / v_ventas_mes) * 100,
        2
      );
  END IF;


  -- ----------------------------------------------------------
  -- CUENTAS POR COBRAR
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(c.saldo_pendiente), 0),
    COALESCE(SUM(c.saldo_pendiente) FILTER (
      WHERE c.fecha_vencimiento < CURRENT_DATE
    ), 0),
    COUNT(*) FILTER (
      WHERE c.fecha_vencimiento < CURRENT_DATE
        AND c.saldo_pendiente > 0
    )
  INTO
    v_cxc_pendiente,
    v_cxc_vencida,
    v_cuentas_vencidas
  FROM public.cuentas_por_cobrar c
  WHERE c.saldo_pendiente > 0;


  -- ----------------------------------------------------------
  -- COMPRAS DEL MES
  -- ----------------------------------------------------------
  SELECT
    COALESCE(SUM(c.total), 0)
  INTO v_compras_mes
  FROM public.compras c
  WHERE c.estado <> 'anulada'
    AND date_trunc('month', c.fecha_compra::timestamp)
      = date_trunc('month', CURRENT_DATE::timestamp);


  -- ----------------------------------------------------------
  -- INVENTARIO
  -- ----------------------------------------------------------
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(e.cantidad, 0) > 0
        AND COALESCE(e.cantidad, 0) <= p.stock_minimo
    ),
    COUNT(*) FILTER (
      WHERE COALESCE(e.cantidad, 0) <= 0
    )
  INTO
    v_stock_bajo,
    v_agotados
  FROM public.productos p
  LEFT JOIN public.existencias e
    ON e.producto_id = p.id
  WHERE p.activo = true;


  -- ----------------------------------------------------------
  -- PEDIDOS EN LÍNEA PENDIENTES DE COMPLETAR
  -- ----------------------------------------------------------
  SELECT COUNT(*)
  INTO v_pedidos_pendientes
  FROM public.pedidos_en_linea p
  WHERE p.estado IN (
    'recibido',
    'confirmado',
    'preparado'
  );


  -- ----------------------------------------------------------
  -- TENDENCIA DE VENTAS · ÚLTIMOS 7 DÍAS
  -- ----------------------------------------------------------
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'fecha', x.fecha,
          'total', x.total
        )
        ORDER BY x.fecha
      ),
      '[]'::jsonb
    )
  INTO v_ventas_7_dias
  FROM (
    SELECT
      d.fecha::date AS fecha,
      COALESCE(SUM(v.total), 0)::numeric(14,2) AS total
    FROM generate_series(
      CURRENT_DATE - INTERVAL '6 days',
      CURRENT_DATE,
      INTERVAL '1 day'
    ) AS d(fecha)
    LEFT JOIN public.ventas v
      ON v.created_at::date = d.fecha::date
      AND v.estado <> 'anulada'
    GROUP BY d.fecha::date
    ORDER BY d.fecha::date
  ) x;


  -- ----------------------------------------------------------
  -- TOP 5 PRODUCTOS DEL MES
  -- ----------------------------------------------------------
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
      AND date_trunc('month', v.created_at)
        = date_trunc('month', CURRENT_DATE::timestamp)
    GROUP BY p.id, p.nombre
    ORDER BY
      SUM(d.cantidad) DESC,
      SUM(d.subtotal) DESC
    LIMIT 5
  ) x;


  -- ----------------------------------------------------------
  -- ÚLTIMA JORNADA DE CAJA
  -- ----------------------------------------------------------
  SELECT
    COALESCE(
      jsonb_build_object(
        'numero', s.numero,
        'estado', s.estado,
        'fecha_apertura', s.fecha_apertura,
        'fecha_cierre', s.fecha_cierre,
        'monto_inicial', s.monto_inicial,
        'diferencia', a.diferencia
      ),
      '{}'::jsonb
    )
  INTO v_ultima_caja
  FROM public.sesiones_caja s
  LEFT JOIN public.arqueos_caja a
    ON a.sesion_caja_id = s.id
  ORDER BY s.fecha_apertura DESC
  LIMIT 1;

  IF v_ultima_caja IS NULL THEN
    v_ultima_caja := '{}'::jsonb;
  END IF;


  -- ----------------------------------------------------------
  -- RESULTADO
  -- ----------------------------------------------------------
  RETURN jsonb_build_object(
    'generado_en', now(),

    'resumen',
    jsonb_build_object(
      'ventas_hoy', ROUND(v_ventas_hoy, 2),
      'ventas_mes', ROUND(v_ventas_mes, 2),
      'operaciones_mes', v_operaciones_mes,

      'ganancia_bruta_mes', ROUND(v_ganancia_bruta_mes, 2),
      'margen_bruto_pct', ROUND(v_margen_bruto, 2),

      'cxc_pendiente', ROUND(v_cxc_pendiente, 2),
      'cxc_vencida', ROUND(v_cxc_vencida, 2),
      'cuentas_vencidas', v_cuentas_vencidas,

      'compras_mes', ROUND(v_compras_mes, 2),

      'stock_bajo', v_stock_bajo,
      'agotados', v_agotados,

      'pedidos_pendientes', v_pedidos_pendientes
    ),

    'ventas_7_dias', v_ventas_7_dias,
    'top_productos', v_top_productos,
    'ultima_caja', v_ultima_caja
  );
END;
$$;


ALTER FUNCTION "public"."dashboard_propietario"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detalle_mi_pedido_web"("p_pedido_id" bigint) RETURNS TABLE("producto_id" bigint, "codigo" "text", "nombre" "text", "cantidad" numeric, "precio_unitario" numeric, "subtotal" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pedidos_en_linea p
    WHERE p.id = p_pedido_id
      AND p.cliente_web_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  RETURN QUERY
  SELECT
    d.producto_id,
    pr.codigo,
    pr.nombre,
    d.cantidad,
    d.precio_unitario,
    d.subtotal
  FROM public.detalle_pedidos_en_linea d
  JOIN public.productos pr
    ON pr.id = d.producto_id
  WHERE d.pedido_id = p_pedido_id
  ORDER BY d.id;
END;
$$;


ALTER FUNCTION "public"."detalle_mi_pedido_web"("p_pedido_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
      id, nombre_completo
    )
    VALUES (
      new.id, v_nombre
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre_completo = coalesce(
        public.profiles.nombre_completo,
        excluded.nombre_completo
      ),
      updated_at = now();
  END IF;

  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mis_pedidos_web"() RETURNS TABLE("id" bigint, "numero" "text", "created_at" timestamp with time zone, "modalidad_entrega" "text", "total" numeric, "estado" "text", "direccion_entrega" "text", "observaciones" "text", "motivo_estado" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.numero,
    p.created_at,
    p.modalidad_entrega,
    p.total,
    p.estado,
    p.direccion_entrega,
    p.observaciones,
    p.motivo_estado
  FROM public.pedidos_en_linea p
  WHERE p.cliente_web_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."mis_pedidos_web"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reembolsar_devolucion_venta"("p_devolucion_id" bigint, "p_metodo_pago" "text", "p_referencia" "text" DEFAULT NULL::"text") RETURNS TABLE("movimiento_id" bigint, "devolucion_id" bigint, "numero_devolucion" "text", "monto_reembolso" numeric, "metodo_pago" "text", "estado_financiero" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_sesion_id bigint;

  v_numero text;
  v_venta_id bigint;
  v_estado_devolucion text;
  v_estado_financiero text;
  v_monto_reembolso numeric(14,2);

  v_metodo_pago text;
  v_movimiento_id bigint;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_caja',
    'ventas'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para registrar reembolsos.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR CAJA ABIERTA
  -- ==========================================================

  SELECT s.id
  INTO v_sesion_id
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Debe abrir una sesión de caja antes de registrar reembolsos.';
  END IF;


  -- ==========================================================
  -- 4. OBTENER Y BLOQUEAR DEVOLUCIÓN
  -- ==========================================================

  SELECT
    d.numero,
    d.venta_id,
    d.estado,
    d.estado_financiero,
    d.monto_reembolso
  INTO
    v_numero,
    v_venta_id,
    v_estado_devolucion,
    v_estado_financiero,
    v_monto_reembolso
  FROM public.devoluciones_venta d
  WHERE d.id = p_devolucion_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La devolución indicada no existe.';
  END IF;


  IF v_estado_devolucion <> 'confirmada' THEN
    RAISE EXCEPTION
      'La devolución % no se encuentra confirmada.',
      v_numero;
  END IF;


  IF v_estado_financiero <> 'pendiente_reembolso' THEN
    RAISE EXCEPTION
      'La devolución % no tiene un reembolso pendiente.',
      v_numero;
  END IF;


  IF v_monto_reembolso IS NULL
     OR v_monto_reembolso <= 0
  THEN
    RAISE EXCEPTION
      'La devolución % no posee un monto válido para reembolsar.',
      v_numero;
  END IF;


  -- Protección adicional
  IF EXISTS (
    SELECT 1
    FROM public.movimientos_caja mc
    WHERE mc.devolucion_venta_id = p_devolucion_id
      AND mc.tipo = 'egreso'
  ) THEN
    RAISE EXCEPTION
      'La devolución % ya posee un reembolso registrado.',
      v_numero;
  END IF;


  -- ==========================================================
  -- 5. VALIDAR MÉTODO DE PAGO
  -- ==========================================================

  v_metodo_pago :=
    LOWER(
      TRIM(
        COALESCE(
          p_metodo_pago,
          ''
        )
      )
    );


  IF v_metodo_pago NOT IN (
    'efectivo',
    'tarjeta',
    'transferencia'
  ) THEN
    RAISE EXCEPTION
      'El método de reembolso debe ser efectivo, tarjeta o transferencia.';
  END IF;


  -- ==========================================================
  -- 6. REGISTRAR EGRESO DE CAJA
  -- ==========================================================

  INSERT INTO public.movimientos_caja (
    venta_id,
    tipo,
    concepto,
    metodo_pago,
    monto,
    referencia,
    creado_por,
    sesion_caja_id,
    devolucion_venta_id
  )
  VALUES (
    v_venta_id,
    'egreso',
    'Reembolso por devolución ' || v_numero,
    v_metodo_pago,
    v_monto_reembolso,
    COALESCE(
      NULLIF(
        TRIM(
          COALESCE(
            p_referencia,
            ''
          )
        ),
        ''
      ),
      v_numero
    ),
    v_usuario,
    v_sesion_id,
    p_devolucion_id
  )
  RETURNING id
  INTO v_movimiento_id;


  -- ==========================================================
  -- 7. MARCAR DEVOLUCIÓN COMO REEMBOLSADA
  -- ==========================================================

  UPDATE public.devoluciones_venta
  SET
    estado_financiero = 'reembolsada',
    reembolsada_at = NOW(),
    reembolsada_por = v_usuario,
    updated_at = NOW()
  WHERE id = p_devolucion_id;


  -- ==========================================================
  -- 8. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_movimiento_id,
    p_devolucion_id,
    v_numero,
    v_monto_reembolso,
    v_metodo_pago,
    'reembolsada'::text;

END;
$$;


ALTER FUNCTION "public"."reembolsar_devolucion_venta"("p_devolucion_id" bigint, "p_metodo_pago" "text", "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_abono_venta"("p_venta_id" bigint, "p_monto" numeric, "p_metodo_pago" "text", "p_monto_recibido" numeric DEFAULT NULL::numeric, "p_referencia" "text" DEFAULT NULL::"text") RETURNS TABLE("pago_id" bigint, "venta_id" bigint, "numero_venta" "text", "monto_abono" numeric, "saldo_anterior" numeric, "saldo_pendiente" numeric, "cambio" numeric, "estado_cuenta" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_sesion_id bigint;

  v_numero_venta text;
  v_tipo_venta text;
  v_estado_venta text;

  v_cuenta_id bigint;
  v_saldo_anterior numeric(14,2);
  v_saldo_nuevo numeric(14,2);
  v_estado_cuenta text;
  v_estado_cuenta_nuevo text;

  v_monto numeric(14,2);
  v_metodo_pago text;
  v_monto_recibido numeric(14,2);
  v_cambio numeric(14,2) := 0;

  v_pago_id bigint;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_caja',
    'ventas'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para registrar abonos.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR SESIÓN DE CAJA
  -- ==========================================================

  SELECT s.id
  INTO v_sesion_id
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Debe abrir una sesión de caja antes de registrar abonos.';
  END IF;


  -- ==========================================================
  -- 4. VALIDAR MONTO
  -- ==========================================================

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION
      'El monto del abono debe ser mayor que cero.';
  END IF;


  v_monto :=
    ROUND(
      p_monto,
      2
    );


  -- ==========================================================
  -- 5. OBTENER Y BLOQUEAR VENTA
  -- ==========================================================

  SELECT
    v.numero,
    v.tipo_venta,
    v.estado
  INTO
    v_numero_venta,
    v_tipo_venta,
    v_estado_venta
  FROM public.ventas v
  WHERE v.id = p_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta indicada no existe.';
  END IF;


  IF v_tipo_venta <> 'credito' THEN
    RAISE EXCEPTION
      'La venta % no corresponde a una venta a crédito.',
      v_numero_venta;
  END IF;


  IF v_estado_venta NOT IN (
    'con_saldo'
  ) THEN
    RAISE EXCEPTION
      'La venta % no admite abonos desde su estado actual (%).',
      v_numero_venta,
      v_estado_venta;
  END IF;


  -- ==========================================================
  -- 6. OBTENER Y BLOQUEAR CUENTA POR COBRAR
  -- ==========================================================

  SELECT
    c.id,
    c.saldo_pendiente,
    c.estado
  INTO
    v_cuenta_id,
    v_saldo_anterior,
    v_estado_cuenta
  FROM public.cuentas_por_cobrar c
  WHERE c.venta_id = p_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta % no posee una cuenta por cobrar.',
      v_numero_venta;
  END IF;


  IF v_saldo_anterior <= 0
     OR v_estado_cuenta = 'pagada'
  THEN
    RAISE EXCEPTION
      'La cuenta por cobrar de la venta % ya se encuentra pagada.',
      v_numero_venta;
  END IF;


  IF v_monto > v_saldo_anterior THEN
    RAISE EXCEPTION
      'El abono (%) no puede superar el saldo pendiente (%).',
      v_monto,
      v_saldo_anterior;
  END IF;


  -- ==========================================================
  -- 7. VALIDAR MÉTODO DE PAGO
  -- ==========================================================

  v_metodo_pago :=
    LOWER(
      TRIM(
        COALESCE(
          p_metodo_pago,
          ''
        )
      )
    );


  IF v_metodo_pago NOT IN (
    'efectivo',
    'tarjeta',
    'transferencia'
  ) THEN
    RAISE EXCEPTION
      'El método de pago debe ser efectivo, tarjeta o transferencia.';
  END IF;


  -- ==========================================================
  -- 8. MONTO RECIBIDO Y CAMBIO
  -- ==========================================================

  IF v_metodo_pago = 'efectivo' THEN

    IF p_monto_recibido IS NULL THEN
      RAISE EXCEPTION
        'Debe indicar el monto recibido para pagos en efectivo.';
    END IF;


    v_monto_recibido :=
      ROUND(
        p_monto_recibido,
        2
      );


    IF v_monto_recibido < v_monto THEN
      RAISE EXCEPTION
        'Monto recibido insuficiente. Abono: %, recibido: %.',
        v_monto,
        v_monto_recibido;
    END IF;


    v_cambio :=
      ROUND(
        v_monto_recibido - v_monto,
        2
      );

  ELSE

    v_monto_recibido := v_monto;
    v_cambio := 0;

  END IF;


  -- ==========================================================
  -- 9. CALCULAR NUEVO SALDO
  -- ==========================================================

  v_saldo_nuevo :=
    ROUND(
      v_saldo_anterior - v_monto,
      2
    );


  IF v_saldo_nuevo = 0 THEN
    v_estado_cuenta_nuevo := 'pagada';
  ELSE
    -- Si estaba vencida, continúa vencida.
    -- Si estaba pendiente, continúa pendiente.
    v_estado_cuenta_nuevo := v_estado_cuenta;
  END IF;


  -- ==========================================================
  -- 10. REGISTRAR PAGO
  -- ==========================================================

  INSERT INTO public.pagos_venta (
    venta_id,
    metodo_pago,
    monto,
    monto_recibido,
    cambio,
    referencia,
    creado_por
  )
  VALUES (
    p_venta_id,
    v_metodo_pago,
    v_monto,
    v_monto_recibido,
    v_cambio,
    NULLIF(
      TRIM(
        COALESCE(
          p_referencia,
          ''
        )
      ),
      ''
    ),
    v_usuario
  )
  RETURNING id
  INTO v_pago_id;


  -- ==========================================================
  -- 11. REGISTRAR INGRESO EN CAJA
  -- ==========================================================

  INSERT INTO public.movimientos_caja (
    venta_id,
    tipo,
    concepto,
    metodo_pago,
    monto,
    referencia,
    creado_por,
    sesion_caja_id,
    pago_venta_id
  )
  VALUES (
    p_venta_id,
    'ingreso',
    'Abono de venta ' || v_numero_venta,
    v_metodo_pago,
    v_monto,
    COALESCE(
      NULLIF(
        TRIM(
          COALESCE(
            p_referencia,
            ''
          )
        ),
        ''
      ),
      v_numero_venta
    ),
    v_usuario,
    v_sesion_id,
    v_pago_id
  );


  -- ==========================================================
  -- 12. ACTUALIZAR CUENTA POR COBRAR
  -- ==========================================================

  UPDATE public.cuentas_por_cobrar
  SET
    saldo_pendiente = v_saldo_nuevo,
    estado = v_estado_cuenta_nuevo,
    updated_at = NOW()
  WHERE id = v_cuenta_id;


  -- ==========================================================
  -- 13. ACTUALIZAR ESTADO DE VENTA SI SE CANCELÓ LA DEUDA
  -- ==========================================================

  IF v_saldo_nuevo = 0 THEN

    UPDATE public.ventas
    SET
      estado = 'pagada',
      updated_at = NOW()
    WHERE id = p_venta_id;

  END IF;


  -- ==========================================================
  -- 14. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_pago_id,
    p_venta_id,
    v_numero_venta,
    v_monto,
    v_saldo_anterior,
    v_saldo_nuevo,
    v_cambio,
    v_estado_cuenta_nuevo;

END;
$$;


ALTER FUNCTION "public"."registrar_abono_venta"("p_venta_id" bigint, "p_monto" numeric, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_arqueo_caja"("p_efectivo_contado" numeric, "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("arqueo_id" bigint, "sesion_id" bigint, "efectivo_esperado" numeric, "efectivo_contado" numeric, "diferencia" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;
  v_sesion_id bigint;
  v_monto_inicial numeric(14,2);
  v_ingresos_efectivo numeric(14,2);
  v_egresos_efectivo numeric(14,2);
  v_esperado numeric(14,2);
  v_diferencia numeric(14,2);
  v_arqueo_id bigint;
BEGIN
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'No tiene permisos para realizar arqueos.';
  END IF;

  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser negativo.';
  END IF;

  SELECT s.id, s.monto_inicial
  INTO v_sesion_id, v_monto_inicial
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  ORDER BY s.fecha_apertura DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe una sesión de caja abierta.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arqueos_caja a
    WHERE a.sesion_caja_id = v_sesion_id
  ) THEN
    RAISE EXCEPTION 'La sesión actual ya posee un arqueo registrado.';
  END IF;

  SELECT
    coalesce(sum(m.monto) FILTER (
      WHERE m.tipo = 'ingreso'
        AND m.metodo_pago = 'efectivo'
    ), 0),
    coalesce(sum(m.monto) FILTER (
      WHERE m.tipo = 'egreso'
        AND m.metodo_pago = 'efectivo'
    ), 0)
  INTO
    v_ingresos_efectivo,
    v_egresos_efectivo
  FROM public.movimientos_caja m
  WHERE m.sesion_caja_id = v_sesion_id;

  v_esperado := round(
    coalesce(v_monto_inicial, 0)
    + coalesce(v_ingresos_efectivo, 0)
    - coalesce(v_egresos_efectivo, 0),
    2
  );

  IF v_esperado < 0 THEN
    v_esperado := 0;
  END IF;

  v_diferencia := round(p_efectivo_contado - v_esperado, 2);

  INSERT INTO public.arqueos_caja (
    sesion_caja_id,
    efectivo_esperado,
    efectivo_contado,
    diferencia,
    observaciones,
    realizado_por
  )
  VALUES (
    v_sesion_id,
    v_esperado,
    round(p_efectivo_contado, 2),
    v_diferencia,
    nullif(trim(coalesce(p_observaciones, '')), ''),
    v_usuario
  )
  RETURNING id
  INTO v_arqueo_id;

  RETURN QUERY
  SELECT
    v_arqueo_id,
    v_sesion_id,
    v_esperado,
    round(p_efectivo_contado, 2),
    v_diferencia;
END;
$$;


ALTER FUNCTION "public"."registrar_arqueo_caja"("p_efectivo_contado" numeric, "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_compra"("p_proveedor_id" bigint, "p_items" "jsonb", "p_tipo_compra" "text" DEFAULT 'directa'::"text", "p_fecha_compra" "date" DEFAULT CURRENT_DATE, "p_referencia_documento" "text" DEFAULT NULL::"text", "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("compra_id" bigint, "numero" "text", "total" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_rol text;

  v_compra_id bigint;
  v_numero text;
  v_total numeric(14,2) := 0;

  v_item jsonb;

  v_producto_id bigint;
  v_cantidad numeric(14,2);
  v_costo_unitario numeric(14,2);
  v_subtotal numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_tipo_compra text;
begin

  -- ==========================================================
  -- 1. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  
      if coalesce(v_rol, '') <> 'encargado_compras' then
    
    raise exception
      'No tiene permisos para registrar compras.';
  end if;


  -- ==========================================================
  -- 2. VALIDAR TIPO DE COMPRA
  -- ==========================================================

  v_tipo_compra :=
    lower(
      trim(
        coalesce(
          p_tipo_compra,
          ''
        )
      )
    );

  if v_tipo_compra not in (
    'directa',
    'cotizacion',
    'licitacion'
  ) then
    raise exception
      'El tipo de compra no es válido.';
  end if;


  -- ==========================================================
  -- 3. VALIDAR PROVEEDOR
  -- ==========================================================

  perform 1
  from public.proveedores
  where id = p_proveedor_id
    and activo = true;

  if not found then
    raise exception
      'El proveedor no existe o se encuentra inactivo.';
  end if;


  -- ==========================================================
  -- 4. VALIDAR DETALLE
  -- ==========================================================

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then

    raise exception
      'La compra debe contener al menos un producto.';
  end if;


  -- ==========================================================
  -- 5. NO PERMITIR PRODUCTOS REPETIDOS
  -- ==========================================================

  if exists (
    select 1
    from (
      select
        (item->>'producto_id')::bigint as producto_id,
        count(*) as cantidad_registros
      from jsonb_array_elements(p_items) as t(item)
      group by
        (item->>'producto_id')::bigint
      having count(*) > 1
    ) duplicados
  ) then
    raise exception
      'Un producto no puede repetirse dentro de la misma compra.';
  end if;


  -- ==========================================================
  -- 6. VALIDAR PRODUCTOS Y CALCULAR TOTAL
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    begin
      v_producto_id :=
        (v_item->>'producto_id')::bigint;

      v_cantidad :=
        (v_item->>'cantidad')::numeric;

      v_costo_unitario :=
        (v_item->>'costo_unitario')::numeric;

    exception
      when others then
        raise exception
          'Existe un producto con datos inválidos dentro de la compra.';
    end;


    if v_producto_id is null then
      raise exception
        'Producto inválido.';
    end if;


    if v_cantidad is null
       or v_cantidad <= 0 then
      raise exception
        'La cantidad de compra debe ser mayor que cero.';
    end if;


    if v_costo_unitario is null
       or v_costo_unitario < 0 then
      raise exception
        'El costo unitario no puede ser negativo.';
    end if;


    select
      p.nombre,
      p.unidad_medida
    into
      v_producto_nombre,
      v_unidad_medida
    from public.productos p
    where p.id = v_producto_id
      and p.activo = true;


    if not found then
      raise exception
        'El producto % no existe o se encuentra inactivo.',
        v_producto_id;
    end if;


    if lower(trim(v_unidad_medida)) = 'unidad'
       and v_cantidad <> trunc(v_cantidad) then

      raise exception
        'La cantidad de % debe ser un número entero porque se maneja por unidad.',
        v_producto_nombre;
    end if;


    v_subtotal :=
      round(
        v_cantidad * v_costo_unitario,
        2
      );

    v_total :=
      v_total + v_subtotal;

  end loop;


  -- ==========================================================
  -- 7. CREAR COMPRA
  -- ==========================================================

  insert into public.compras (
    proveedor_id,
    fecha_compra,
    referencia_documento,
    observaciones,
    total,
    estado,
    tipo_compra,
    creado_por
  )
  values (
    p_proveedor_id,
    coalesce(
      p_fecha_compra,
      current_date
    ),
    nullif(
      trim(
        coalesce(
          p_referencia_documento,
          ''
        )
      ),
      ''
    ),
    nullif(
      trim(
        coalesce(
          p_observaciones,
          ''
        )
      ),
      ''
    ),
    v_total,
    'registrada',
    v_tipo_compra,
    auth.uid()
  )
  returning
    id,
    compras.numero
  into
    v_compra_id,
    v_numero;


  -- ==========================================================
  -- 8. GUARDAR DETALLE
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_producto_id :=
      (v_item->>'producto_id')::bigint;

    v_cantidad :=
      (v_item->>'cantidad')::numeric;

    v_costo_unitario :=
      (v_item->>'costo_unitario')::numeric;

    v_subtotal :=
      round(
        v_cantidad * v_costo_unitario,
        2
      );


    insert into public.detalle_compras (
      compra_id,
      producto_id,
      cantidad,
      costo_unitario,
      subtotal
    )
    values (
      v_compra_id,
      v_producto_id,
      v_cantidad,
      v_costo_unitario,
      v_subtotal
    );

  end loop;


  -- ==========================================================
  -- 9. RESULTADO
  -- ==========================================================

  return query
  select
    v_compra_id,
    v_numero,
    v_total;

end;
$$;


ALTER FUNCTION "public"."registrar_compra"("p_proveedor_id" bigint, "p_items" "jsonb", "p_tipo_compra" "text", "p_fecha_compra" "date", "p_referencia_documento" "text", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_devolucion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_fecha_devolucion" "date" DEFAULT CURRENT_DATE, "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("devolucion_id" bigint, "numero" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_rol text;

  v_compra record;

  v_devolucion_id bigint;
  v_numero_devolucion text;

  v_item jsonb;

  v_producto_id bigint;
  v_cantidad_devuelta numeric(14,2);

  v_cantidad_recibida numeric(14,2);
  v_cantidad_ya_devuelta numeric(14,2);
  v_cantidad_disponible_devolver numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);
begin

  -- ==========================================================
  -- 1. VALIDAR ROL
  -- ==========================================================

  v_rol :=
    public.current_role_code();


  
      if coalesce(v_rol, '') <> 'responsable_compras' then
    

    raise exception
      'No tiene permisos para registrar devoluciones de compra.';

  end if;


  -- ==========================================================
  -- 2. VALIDAR MOTIVO
  -- ==========================================================

  if p_motivo is null
     or length(
       trim(p_motivo)
     ) < 3 then

    raise exception
      'Debe indicar un motivo válido para la devolución.';

  end if;


  -- ==========================================================
  -- 3. OBTENER COMPRA
  -- ==========================================================

  select
    c.id,
    c.numero,
    c.estado
  into
    v_compra
  from public.compras c
  where c.id =
    p_compra_id
  for update;


  if not found then

    raise exception
      'La compra indicada no existe.';

  end if;


  if v_compra.estado <>
     'recibida' then

    raise exception
      'Solo pueden devolverse productos de una compra recibida. Compra: %.',
      v_compra.numero;

  end if;


  -- ==========================================================
  -- 4. VALIDAR ITEMS
  -- ==========================================================

  if p_items is null
     or jsonb_typeof(
       p_items
     ) <> 'array'
     or jsonb_array_length(
       p_items
     ) = 0 then

    raise exception
      'La devolución debe contener al menos un producto.';

  end if;


  -- Evitar productos repetidos
  if exists (
    select 1
    from (
      select
        (
          item->>'producto_id'
        )::bigint
          as producto_id,

        count(*)
          as cantidad_registros

      from jsonb_array_elements(
        p_items
      ) as t(item)

      group by
        (
          item->>'producto_id'
        )::bigint

      having count(*) > 1
    ) duplicados
  ) then

    raise exception
      'Un producto no puede repetirse dentro de la devolución.';

  end if;


  -- ==========================================================
  -- 5. VALIDAR CADA PRODUCTO
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(
      p_items
    )
  loop

    begin

      v_producto_id :=
        (
          v_item->>'producto_id'
        )::bigint;


      v_cantidad_devuelta :=
        (
          v_item->>'cantidad_devuelta'
        )::numeric;

    exception
      when others then

        raise exception
          'Existe un producto con datos inválidos en la devolución.';

    end;


    if v_producto_id is null then

      raise exception
        'Producto inválido.';

    end if;


    if v_cantidad_devuelta is null
       or v_cantidad_devuelta <= 0 then

      raise exception
        'La cantidad a devolver debe ser mayor que cero.';

    end if;


    -- ----------------------------------------------------------
    -- Cantidad que realmente fue recibida
    -- ----------------------------------------------------------

    select
      drc.cantidad_recibida,
      p.nombre,
      p.unidad_medida
    into
      v_cantidad_recibida,
      v_producto_nombre,
      v_unidad_medida
    from public.recepciones_compra rc

    join public.detalle_recepciones_compra drc
      on drc.recepcion_id =
         rc.id

    join public.productos p
      on p.id =
         drc.producto_id

    where rc.compra_id =
          p_compra_id

      and drc.producto_id =
          v_producto_id;


    if not found then

      raise exception
        'El producto % no pertenece a la recepción de la compra %.',
        v_producto_id,
        v_compra.numero;

    end if;


    -- ----------------------------------------------------------
    -- Cantidad devuelta anteriormente
    -- ----------------------------------------------------------

    select
      coalesce(
        sum(
          ddc.cantidad_devuelta
        ),
        0
      )
    into
      v_cantidad_ya_devuelta
    from public.devoluciones_compra dc

    join public.detalle_devoluciones_compra ddc
      on ddc.devolucion_id =
         dc.id

    where dc.compra_id =
          p_compra_id

      and ddc.producto_id =
          v_producto_id;


    v_cantidad_disponible_devolver :=
      v_cantidad_recibida -
      v_cantidad_ya_devuelta;


    if v_cantidad_devuelta >
       v_cantidad_disponible_devolver then

      raise exception
        'No puede devolver % unidades de %. Disponible para devolución: %.',
        v_cantidad_devuelta,
        v_producto_nombre,
        v_cantidad_disponible_devolver;

    end if;


    -- ----------------------------------------------------------
    -- Validar cantidades enteras para unidad
    -- ----------------------------------------------------------

    if lower(
      trim(
        v_unidad_medida
      )
    ) = 'unidad'
       and
       v_cantidad_devuelta <>
       trunc(
         v_cantidad_devuelta
       ) then

      raise exception
        'La cantidad a devolver de % debe ser un número entero.',
        v_producto_nombre;

    end if;


    -- ----------------------------------------------------------
    -- Validar existencia física
    -- ----------------------------------------------------------

    select
      e.cantidad
    into
      v_existencia_actual
    from public.existencias e

    where e.producto_id =
          v_producto_id

    for update;


    if not found then

      raise exception
        'No existe inventario para el producto %.',

        v_producto_nombre;

    end if;


    if v_existencia_actual <
       v_cantidad_devuelta then

      raise exception
        'No existe suficiente inventario para devolver %. Disponible: %, requerido: %.',
        v_producto_nombre,
        v_existencia_actual,
        v_cantidad_devuelta;

    end if;

  end loop;


  -- ==========================================================
  -- 6. CREAR DEVOLUCIÓN
  -- ==========================================================

  insert into public.devoluciones_compra (
    compra_id,
    fecha_devolucion,
    motivo,
    observaciones,
    creado_por
  )
  values (
    p_compra_id,

    coalesce(
      p_fecha_devolucion,
      current_date
    ),

    trim(
      p_motivo
    ),

    nullif(
      trim(
        coalesce(
          p_observaciones,
          ''
        )
      ),
      ''
    ),

    auth.uid()
  )
  returning
    id,
    devoluciones_compra.numero
  into
    v_devolucion_id,
    v_numero_devolucion;


  -- ==========================================================
  -- 7. DETALLE + SALIDA DE INVENTARIO
  -- ==========================================================

  for v_item in
    select value
    from jsonb_array_elements(
      p_items
    )
  loop

    v_producto_id :=
      (
        v_item->>'producto_id'
      )::bigint;


    v_cantidad_devuelta :=
      (
        v_item->>'cantidad_devuelta'
      )::numeric;


    -- Guardar detalle
    insert into public.detalle_devoluciones_compra (
      devolucion_id,
      producto_id,
      cantidad_devuelta
    )
    values (
      v_devolucion_id,
      v_producto_id,
      v_cantidad_devuelta
    );


    -- Bloquear existencia
    select
      e.cantidad
    into
      v_existencia_actual
    from public.existencias e

    where e.producto_id =
          v_producto_id

    for update;


    v_existencia_nueva :=
      v_existencia_actual -
      v_cantidad_devuelta;


    -- Actualizar inventario
    update public.existencias
    set
      cantidad =
        v_existencia_nueva
    where producto_id =
          v_producto_id;


    -- Kardex
    insert into public.movimientos_inventario (
      producto_id,
      tipo,
      cantidad,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      referencia,
      creado_por
    )
    values (
      v_producto_id,
      'salida',
      v_cantidad_devuelta,
      v_existencia_actual,
      v_existencia_nueva,

      'Devolución de compra ' ||
      v_compra.numero,

      v_numero_devolucion,

      auth.uid()
    );

  end loop;


  -- ==========================================================
  -- 8. RESULTADO
  -- ==========================================================

  return query
  select
    v_devolucion_id,
    v_numero_devolucion;

end;
$$;


ALTER FUNCTION "public"."registrar_devolucion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_fecha_devolucion" "date", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_devolucion_venta"("p_venta_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("devolucion_id" bigint, "numero" "text", "total" numeric, "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_venta record;

  v_item jsonb;
  v_producto_id bigint;
  v_cantidad numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_cantidad_vendida numeric(14,2);
  v_cantidad_ya_devuelta numeric(14,2);
  v_cantidad_disponible numeric(14,2);

  v_subtotal_original numeric(14,2);
  v_total_ya_devuelto_producto numeric(14,2);

  v_precio_unitario numeric(14,2);
  v_subtotal_devolucion numeric(14,2);

  v_total numeric(14,2) := 0;

  v_devolucion_id bigint;
  v_numero text;

BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'vendedor'
  ) THEN
    RAISE EXCEPTION
      'No tiene permisos para registrar devoluciones de venta.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR VENTA
  -- ==========================================================

  SELECT
    v.id,
    v.numero,
    v.estado,
    v.tipo_venta
  INTO
    v_venta
  FROM public.ventas v
  WHERE v.id = p_venta_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION
      'La venta indicada no existe.';
  END IF;


  IF v_venta.estado NOT IN (
    'pagada',
    'completada',
    'con_saldo'
  ) THEN
    RAISE EXCEPTION
      'La venta % no puede recibir devoluciones desde su estado actual (%).',
      v_venta.numero,
      v_venta.estado;
  END IF;


  -- ==========================================================
  -- 4. VALIDAR MOTIVO
  -- ==========================================================

  IF p_motivo IS NULL
     OR LENGTH(TRIM(p_motivo)) < 3
  THEN
    RAISE EXCEPTION
      'Debe indicar un motivo válido para la devolución.';
  END IF;


  -- ==========================================================
  -- 5. VALIDAR ITEMS
  -- ==========================================================

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION
      'La devolución debe contener al menos un producto.';
  END IF;


  -- No permitir productos repetidos
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS t(item)
    GROUP BY item ->> 'producto_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Un producto no puede repetirse dentro de la misma devolución.';
  END IF;


  -- ==========================================================
  -- 6. VALIDAR PRODUCTOS Y CALCULAR TOTAL
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    BEGIN

      v_producto_id :=
        NULLIF(
          v_item ->> 'producto_id',
          ''
        )::bigint;


      v_cantidad :=
        COALESCE(
          NULLIF(
            v_item ->> 'cantidad',
            ''
          ),
          NULLIF(
            v_item ->> 'cantidad_devuelta',
            ''
          )
        )::numeric;

    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Existe un producto con datos inválidos en la devolución.';
    END;


    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION
        'Producto inválido.';
    END IF;


    IF v_cantidad IS NULL
       OR v_cantidad <= 0
    THEN
      RAISE EXCEPTION
        'La cantidad a devolver debe ser mayor que cero.';
    END IF;


    -- ----------------------------------------------------------
    -- Obtener cantidad y valor realmente vendidos
    -- ----------------------------------------------------------

    SELECT
      SUM(dv.cantidad),
      SUM(dv.subtotal),
      MAX(p.nombre),
      MAX(p.unidad_medida)
    INTO
      v_cantidad_vendida,
      v_subtotal_original,
      v_producto_nombre,
      v_unidad_medida
    FROM public.detalle_ventas dv
    JOIN public.productos p
      ON p.id = dv.producto_id
    WHERE dv.venta_id = p_venta_id
      AND dv.producto_id = v_producto_id;


    IF v_cantidad_vendida IS NULL THEN
      RAISE EXCEPTION
        'El producto % no pertenece a la venta %.',
        v_producto_id,
        v_venta.numero;
    END IF;


    -- ----------------------------------------------------------
    -- Cantidad ya devuelta o reservada en otra devolución
    -- registrada/confirmada
    -- ----------------------------------------------------------

    SELECT
      COALESCE(SUM(ddv.cantidad), 0),
      COALESCE(SUM(ddv.subtotal), 0)
    INTO
      v_cantidad_ya_devuelta,
      v_total_ya_devuelto_producto
    FROM public.devoluciones_venta d
    JOIN public.detalle_devoluciones_venta ddv
      ON ddv.devolucion_id = d.id
    WHERE d.venta_id = p_venta_id
      AND d.estado IN (
        'registrada',
        'confirmada'
      )
      AND ddv.producto_id = v_producto_id;


    v_cantidad_disponible :=
      v_cantidad_vendida -
      v_cantidad_ya_devuelta;


    IF v_cantidad > v_cantidad_disponible THEN
      RAISE EXCEPTION
        'No puede devolver % unidades de %. Disponible para devolución: %.',
        v_cantidad,
        v_producto_nombre,
        v_cantidad_disponible;
    END IF;


    -- ----------------------------------------------------------
    -- Productos vendidos por unidad deben devolverse enteros
    -- ----------------------------------------------------------

    IF LOWER(TRIM(v_unidad_medida)) = 'unidad'
       AND v_cantidad <> TRUNC(v_cantidad)
    THEN
      RAISE EXCEPTION
        'La cantidad a devolver de % debe ser un número entero.',
        v_producto_nombre;
    END IF;


    -- ----------------------------------------------------------
    -- Calcular valor proporcional realmente vendido
    -- ----------------------------------------------------------

    v_precio_unitario :=
      ROUND(
        v_subtotal_original /
        v_cantidad_vendida,
        2
      );


    -- Si se devuelve todo lo que queda disponible,
    -- absorber cualquier diferencia de redondeo.
    IF v_cantidad = v_cantidad_disponible THEN

      v_subtotal_devolucion :=
        ROUND(
          v_subtotal_original -
          v_total_ya_devuelto_producto,
          2
        );

    ELSE

      v_subtotal_devolucion :=
        ROUND(
          (
            v_subtotal_original /
            v_cantidad_vendida
          ) * v_cantidad,
          2
        );

    END IF;


    v_total :=
      v_total +
      v_subtotal_devolucion;

  END LOOP;


  -- ==========================================================
  -- 7. GENERAR NÚMERO
  -- ==========================================================

  v_numero :=
    'DV-' ||
    LPAD(
      NEXTVAL(
        'public.devolucion_venta_numero_seq'
      )::text,
      6,
      '0'
    );


  -- ==========================================================
  -- 8. CREAR DEVOLUCIÓN
  -- ==========================================================

  INSERT INTO public.devoluciones_venta (
    numero,
    venta_id,
    motivo,
    total,
    estado,
    observaciones,
    creada_por
  )
  VALUES (
    v_numero,
    p_venta_id,
    TRIM(p_motivo),
    ROUND(v_total, 2),
    'registrada',
    NULLIF(
      TRIM(
        COALESCE(
          p_observaciones,
          ''
        )
      ),
      ''
    ),
    v_usuario
  )
  RETURNING id
  INTO v_devolucion_id;


  -- ==========================================================
  -- 9. GUARDAR DETALLE
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    v_producto_id :=
      (v_item ->> 'producto_id')::bigint;


    v_cantidad :=
      COALESCE(
        NULLIF(
          v_item ->> 'cantidad',
          ''
        ),
        NULLIF(
          v_item ->> 'cantidad_devuelta',
          ''
        )
      )::numeric;


    SELECT
      SUM(dv.cantidad),
      SUM(dv.subtotal)
    INTO
      v_cantidad_vendida,
      v_subtotal_original
    FROM public.detalle_ventas dv
    WHERE dv.venta_id = p_venta_id
      AND dv.producto_id = v_producto_id;


    SELECT
      COALESCE(SUM(ddv.cantidad), 0),
      COALESCE(SUM(ddv.subtotal), 0)
    INTO
      v_cantidad_ya_devuelta,
      v_total_ya_devuelto_producto
    FROM public.devoluciones_venta d
    JOIN public.detalle_devoluciones_venta ddv
      ON ddv.devolucion_id = d.id
    WHERE d.venta_id = p_venta_id
      AND d.id <> v_devolucion_id
      AND d.estado IN (
        'registrada',
        'confirmada'
      )
      AND ddv.producto_id = v_producto_id;


    v_cantidad_disponible :=
      v_cantidad_vendida -
      v_cantidad_ya_devuelta;


    v_precio_unitario :=
      ROUND(
        v_subtotal_original /
        v_cantidad_vendida,
        2
      );


    IF v_cantidad = v_cantidad_disponible THEN

      v_subtotal_devolucion :=
        ROUND(
          v_subtotal_original -
          v_total_ya_devuelto_producto,
          2
        );

    ELSE

      v_subtotal_devolucion :=
        ROUND(
          (
            v_subtotal_original /
            v_cantidad_vendida
          ) * v_cantidad,
          2
        );

    END IF;


    INSERT INTO public.detalle_devoluciones_venta (
      devolucion_id,
      producto_id,
      cantidad,
      precio_unitario,
      subtotal,
      observaciones
    )
    VALUES (
      v_devolucion_id,
      v_producto_id,
      v_cantidad,
      v_precio_unitario,
      v_subtotal_devolucion,
      NULLIF(
        TRIM(
          COALESCE(
            v_item ->> 'observaciones',
            ''
          )
        ),
        ''
      )
    );

  END LOOP;


  -- ==========================================================
  -- 10. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_devolucion_id,
    v_numero,
    ROUND(v_total, 2),
    'registrada'::text;

END;
$$;


ALTER FUNCTION "public"."registrar_devolucion_venta"("p_venta_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_movimiento_caja"("p_tipo" "text", "p_concepto" "text", "p_metodo_pago" "text", "p_monto" numeric, "p_referencia" "text" DEFAULT NULL::"text") RETURNS TABLE("movimiento_id" bigint, "sesion_id" bigint, "tipo" "text", "monto" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;
  v_sesion_id bigint;
  v_tipo text;
  v_metodo text;
  v_movimiento_id bigint;
BEGIN
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'No tiene permisos para registrar movimientos de caja.';
  END IF;

  SELECT s.id
  INTO v_sesion_id
  FROM public.sesiones_caja s
  WHERE s.abierta_por = v_usuario
    AND s.estado = 'abierta'
  ORDER BY s.fecha_apertura DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debe abrir una sesión de caja antes de registrar movimientos.';
  END IF;

  v_tipo := lower(trim(coalesce(p_tipo, '')));

  IF v_tipo NOT IN ('ingreso', 'egreso') THEN
    RAISE EXCEPTION 'El tipo debe ser ingreso o egreso.';
  END IF;

  IF p_concepto IS NULL OR length(trim(p_concepto)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar un concepto válido.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.';
  END IF;

  v_metodo := lower(trim(coalesce(p_metodo_pago, '')));

  IF v_metodo NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'El método de pago debe ser efectivo, tarjeta o transferencia.';
  END IF;

  INSERT INTO public.movimientos_caja (
    tipo,
    concepto,
    metodo_pago,
    monto,
    referencia,
    creado_por,
    sesion_caja_id
  )
  VALUES (
    v_tipo,
    trim(p_concepto),
    v_metodo,
    round(p_monto, 2),
    nullif(trim(coalesce(p_referencia, '')), ''),
    v_usuario,
    v_sesion_id
  )
  RETURNING id
  INTO v_movimiento_id;

  RETURN QUERY
  SELECT
    v_movimiento_id,
    v_sesion_id,
    v_tipo,
    round(p_monto, 2);
END;
$$;


ALTER FUNCTION "public"."registrar_movimiento_caja"("p_tipo" "text", "p_concepto" "text", "p_metodo_pago" "text", "p_monto" numeric, "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_movimiento_inventario"("p_producto_id" bigint, "p_tipo" "text", "p_cantidad" numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_referencia" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rol text;
  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);
  v_movimiento_id bigint;
begin

  -- ----------------------------------------------------------
  -- Obtener rol actual
  -- ----------------------------------------------------------

  v_rol := public.current_role_code();

  if v_rol is null then
    raise exception
      'Usuario sin rol válido o usuario inactivo.';
  end if;


  -- ----------------------------------------------------------
  -- Solamente Administración y Almacén pueden realizar
  -- movimientos manuales de inventario en este segmento.
  -- ----------------------------------------------------------

  if v_rol not in (
    'administracion',
    'almacen'
  ) then
    raise exception
      'No tiene autorización para registrar movimientos de inventario.';
  end if;


  -- ----------------------------------------------------------
  -- Validaciones
  -- ----------------------------------------------------------

  if p_tipo not in (
    'entrada',
    'salida',
    'ajuste_positivo',
    'ajuste_negativo'
  ) then
    raise exception
      'Tipo de movimiento no válido.';
  end if;

  if p_cantidad is null
     or p_cantidad <= 0 then
    raise exception
      'La cantidad debe ser mayor que cero.';
  end if;


  -- ----------------------------------------------------------
  -- Verificar producto
  -- ----------------------------------------------------------

  if not exists (
    select 1
    from public.productos
    where id = p_producto_id
      and activo = true
  ) then
    raise exception
      'El producto no existe o está inactivo.';
  end if;


  -- ----------------------------------------------------------
  -- Asegurar existencia del producto
  -- ----------------------------------------------------------

  insert into public.existencias (
    producto_id,
    cantidad
  )
  values (
    p_producto_id,
    0
  )
  on conflict (producto_id) do nothing;


  -- ----------------------------------------------------------
  -- Bloquear fila mientras se realiza el movimiento
  -- ----------------------------------------------------------

  select cantidad
  into v_existencia_actual
  from public.existencias
  where producto_id = p_producto_id
  for update;


  -- ----------------------------------------------------------
  -- Calcular nueva existencia
  -- ----------------------------------------------------------

  case p_tipo

    when 'entrada' then
      v_existencia_nueva :=
        v_existencia_actual + p_cantidad;

    when 'ajuste_positivo' then
      v_existencia_nueva :=
        v_existencia_actual + p_cantidad;

    when 'salida' then
      v_existencia_nueva :=
        v_existencia_actual - p_cantidad;

    when 'ajuste_negativo' then
      v_existencia_nueva :=
        v_existencia_actual - p_cantidad;

  end case;


  -- ----------------------------------------------------------
  -- Nunca permitir inventario negativo
  -- ----------------------------------------------------------

  if v_existencia_nueva < 0 then
    raise exception
      'Existencia insuficiente. Disponible: %, solicitado: %.',
      v_existencia_actual,
      p_cantidad;
  end if;


  -- ----------------------------------------------------------
  -- Actualizar existencia
  -- ----------------------------------------------------------

  update public.existencias
  set cantidad = v_existencia_nueva
  where producto_id = p_producto_id;


  -- ----------------------------------------------------------
  -- Registrar historial
  -- ----------------------------------------------------------

  insert into public.movimientos_inventario (
    producto_id,
    tipo,
    cantidad,
    cantidad_anterior,
    cantidad_nueva,
    motivo,
    referencia,
    creado_por
  )
  values (
    p_producto_id,
    p_tipo,
    p_cantidad,
    v_existencia_actual,
    v_existencia_nueva,
    nullif(trim(p_motivo), ''),
    nullif(trim(p_referencia), ''),
    auth.uid()
  )
  returning id
  into v_movimiento_id;


  return v_movimiento_id;

end;
$$;


ALTER FUNCTION "public"."registrar_movimiento_inventario"("p_producto_id" bigint, "p_tipo" "text", "p_cantidad" numeric, "p_motivo" "text", "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_pedido_web"("p_items" "jsonb", "p_modalidad_entrega" "text" DEFAULT 'retiro'::"text", "p_direccion_entrega" "text" DEFAULT NULL::"text", "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("pedido_id" bigint, "numero" "text", "total" numeric, "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cliente public.clientes_web%ROWTYPE;
  v_modalidad text;
  v_item jsonb;
  v_producto_id bigint;
  v_cantidad numeric(14,2);
  v_producto public.productos%ROWTYPE;
  v_existencia numeric(14,2);
  v_precio numeric(14,2);
  v_subtotal numeric(14,2);
  v_total numeric(14,2) := 0;
  v_pedido_id bigint;
  v_numero text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debe iniciar sesión como cliente.';
  END IF;

  IF public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Esta cuenta no pertenece a la tienda en línea.';
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes_web
  WHERE id = v_uid AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta de cliente no está activa.';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe contener productos.';
  END IF;

  v_modalidad := lower(trim(coalesce(p_modalidad_entrega, 'retiro')));

  IF v_modalidad NOT IN ('retiro', 'domicilio') THEN
    RAISE EXCEPTION 'Modalidad de entrega inválida.';
  END IF;

  IF v_modalidad = 'domicilio'
     AND nullif(trim(coalesce(p_direccion_entrega, v_cliente.direccion, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Debe indicar una dirección de entrega.';
  END IF;

  v_numero := 'WEB-' ||
    lpad(nextval('public.pedido_web_numero_seq')::text, 6, '0');

  INSERT INTO public.pedidos_en_linea (
    numero,
    cliente_web_id,
    cliente_nombre,
    telefono,
    correo,
    modalidad_entrega,
    direccion_entrega,
    subtotal,
    descuento,
    total,
    estado,
    observaciones
  )
  VALUES (
    v_numero,
    v_cliente.id,
    v_cliente.nombre,
    v_cliente.telefono,
    v_cliente.correo,
    v_modalidad,
    CASE
      WHEN v_modalidad = 'domicilio'
      THEN coalesce(
        nullif(trim(coalesce(p_direccion_entrega, '')), ''),
        v_cliente.direccion
      )
      ELSE NULL
    END,
    0, 0, 0,
    'recibido',
    nullif(trim(coalesce(p_observaciones, '')), '')
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := nullif(v_item ->> 'producto_id', '')::bigint;
    v_cantidad := nullif(v_item ->> 'cantidad', '')::numeric;

    IF v_producto_id IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Hay una cantidad inválida.';
    END IF;

    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_producto_id AND activo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no está disponible.';
    END IF;

    SELECT coalesce(cantidad, 0)
    INTO v_existencia
    FROM public.existencias
    WHERE producto_id = v_producto_id;

    v_existencia := coalesce(v_existencia, 0);

    IF v_existencia < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para %.', v_producto.nombre;
    END IF;

    v_precio := round(
      v_producto.precio_venta *
      (1 - coalesce(v_producto.descuento_porcentaje, 0) / 100),
      2
    );

    v_subtotal := round(v_precio * v_cantidad, 2);

    INSERT INTO public.detalle_pedidos_en_linea (
      pedido_id, producto_id, cantidad, precio_unitario, subtotal
    )
    VALUES (
      v_pedido_id, v_producto_id, v_cantidad, v_precio, v_subtotal
    );

    v_total := v_total + v_subtotal;
  END LOOP;

  UPDATE public.pedidos_en_linea
  SET subtotal = round(v_total, 2),
      total = round(v_total, 2),
      updated_at = now()
  WHERE id = v_pedido_id;

  RETURN QUERY
  SELECT
    v_pedido_id,
    v_numero,
    round(v_total, 2),
    'recibido'::text;
END;
$$;


ALTER FUNCTION "public"."registrar_pedido_web"("p_items" "jsonb", "p_modalidad_entrega" "text", "p_direccion_entrega" "text", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_recepcion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_fecha_recepcion" "date" DEFAULT CURRENT_DATE, "p_observaciones" "text" DEFAULT NULL::"text") RETURNS TABLE("recepcion_id" bigint, "numero" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_rol text;
  v_compra record;

  v_recepcion_id bigint;
  v_numero_recepcion text;

  v_item jsonb;

  v_producto_id bigint;
  v_cantidad_recibida numeric(14,2);
  v_cantidad_comprada numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;

  v_existencia_actual numeric(12,2);
  v_existencia_nueva numeric(12,2);
begin

  -- ----------------------------------------------------------
  -- 1. VALIDAR ROL
  -- ----------------------------------------------------------

  v_rol := public.current_role_code();

  
      if coalesce(v_rol, '') <> 'almacen' then
    
    raise exception
      'No tiene permisos para registrar recepciones de compra.';
  end if;


  -- ----------------------------------------------------------
  -- 2. OBTENER COMPRA
  -- ----------------------------------------------------------

  select
    c.id,
    c.numero,
    c.estado
  into v_compra
  from public.compras c
  where c.id = p_compra_id
  for update;


  if not found then
    raise exception
      'La compra indicada no existe.';
  end if;


  if v_compra.estado = 'anulada' then
    raise exception
      'La compra % se encuentra anulada.',
      v_compra.numero;
  end if;


  if v_compra.estado = 'recibida' then
    raise exception
      'La compra % ya fue recibida.',
      v_compra.numero;
  end if;


  if v_compra.estado <> 'autorizada' then
    raise exception
      'La compra % debe estar autorizada antes de registrarse su recepción.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- 3. EVITAR DOBLE RECEPCIÓN
  -- ----------------------------------------------------------

  if exists (
    select 1
    from public.recepciones_compra rc
    where rc.compra_id = p_compra_id
  ) then
    raise exception
      'La compra % ya tiene una recepción registrada.',
      v_compra.numero;
  end if;


  -- ----------------------------------------------------------
  -- 4. VALIDAR ITEMS
  -- ----------------------------------------------------------

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception
      'La recepción debe contener al menos un producto.';
  end if;


  if exists (
    select 1
    from (
      select
        (item->>'producto_id')::bigint as producto_id,
        count(*) as cantidad_registros
      from jsonb_array_elements(p_items) as t(item)
      group by
        (item->>'producto_id')::bigint
      having count(*) > 1
    ) duplicados
  ) then
    raise exception
      'Un producto no puede repetirse dentro de la recepción.';
  end if;


  if jsonb_array_length(p_items) <>
     (
       select count(*)
       from public.detalle_compras dc
       where dc.compra_id = p_compra_id
     ) then
    raise exception
      'La recepción debe incluir todos los productos de la compra.';
  end if;


  -- ----------------------------------------------------------
  -- 5. VALIDAR CANTIDADES
  -- ----------------------------------------------------------

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    begin
      v_producto_id :=
        (v_item->>'producto_id')::bigint;

      v_cantidad_recibida :=
        (v_item->>'cantidad_recibida')::numeric;

    exception
      when others then
        raise exception
          'Existe un producto con datos inválidos en la recepción.';
    end;


    if v_producto_id is null then
      raise exception
        'Producto inválido.';
    end if;


    if v_cantidad_recibida is null
       or v_cantidad_recibida <= 0 then
      raise exception
        'La cantidad recibida debe ser mayor que cero.';
    end if;


    select
      dc.cantidad,
      p.nombre,
      p.unidad_medida
    into
      v_cantidad_comprada,
      v_producto_nombre,
      v_unidad_medida
    from public.detalle_compras dc
    join public.productos p
      on p.id = dc.producto_id
    where dc.compra_id = p_compra_id
      and dc.producto_id = v_producto_id;


    if not found then
      raise exception
        'El producto % no pertenece a la compra %.',
        v_producto_id,
        v_compra.numero;
    end if;


    if v_cantidad_recibida <> v_cantidad_comprada then
      raise exception
        'La cantidad recibida de % debe coincidir con la cantidad comprada. Comprada: %, recibida: %.',
        v_producto_nombre,
        v_cantidad_comprada,
        v_cantidad_recibida;
    end if;


    if lower(trim(v_unidad_medida)) = 'unidad'
       and v_cantidad_recibida <> trunc(v_cantidad_recibida) then
      raise exception
        'La cantidad recibida de % debe ser un número entero.',
        v_producto_nombre;
    end if;

  end loop;


  -- ----------------------------------------------------------
  -- 6. CREAR RECEPCIÓN
  -- ----------------------------------------------------------

  insert into public.recepciones_compra (
    compra_id,
    fecha_recepcion,
    observaciones,
    recibido_por
  )
  values (
    p_compra_id,
    coalesce(
      p_fecha_recepcion,
      current_date
    ),
    nullif(
      trim(
        coalesce(
          p_observaciones,
          ''
        )
      ),
      ''
    ),
    auth.uid()
  )
  returning
    id,
    recepciones_compra.numero
  into
    v_recepcion_id,
    v_numero_recepcion;


  -- ----------------------------------------------------------
  -- 7. DETALLE + INVENTARIO + KARDEX
  -- ----------------------------------------------------------

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop

    v_producto_id :=
      (v_item->>'producto_id')::bigint;

    v_cantidad_recibida :=
      (v_item->>'cantidad_recibida')::numeric;


    insert into public.detalle_recepciones_compra (
      recepcion_id,
      producto_id,
      cantidad_recibida
    )
    values (
      v_recepcion_id,
      v_producto_id,
      v_cantidad_recibida
    );


    insert into public.existencias (
      producto_id,
      cantidad
    )
    values (
      v_producto_id,
      0
    )
    on conflict (producto_id) do nothing;


    select e.cantidad
    into v_existencia_actual
    from public.existencias e
    where e.producto_id = v_producto_id
    for update;


    v_existencia_nueva :=
      v_existencia_actual +
      v_cantidad_recibida;


    update public.existencias
    set cantidad = v_existencia_nueva
    where producto_id = v_producto_id;


    insert into public.movimientos_inventario (
      producto_id,
      tipo,
      cantidad,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      referencia,
      creado_por
    )
    values (
      v_producto_id,
      'entrada',
      v_cantidad_recibida,
      v_existencia_actual,
      v_existencia_nueva,
      'Recepción de compra ' ||
        v_compra.numero,
      v_numero_recepcion,
      auth.uid()
    );

  end loop;


  -- ----------------------------------------------------------
  -- 8. MARCAR COMPRA COMO RECIBIDA
  -- ----------------------------------------------------------

  update public.compras
  set estado = 'recibida'
  where id = p_compra_id;


  -- ----------------------------------------------------------
  -- 9. RESULTADO
  -- ----------------------------------------------------------

  return query
  select
    v_recepcion_id,
    v_numero_recepcion;

end;
$$;


ALTER FUNCTION "public"."registrar_recepcion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_fecha_recepcion" "date", "p_observaciones" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_venta"("p_items" "jsonb", "p_tipo_venta" "text" DEFAULT 'contado'::"text", "p_cliente_id" bigint DEFAULT NULL::bigint, "p_cliente_nombre" "text" DEFAULT NULL::"text", "p_cotizacion_id" bigint DEFAULT NULL::bigint, "p_fecha_vencimiento" "date" DEFAULT NULL::"date", "p_referencia" "text" DEFAULT NULL::"text") RETURNS TABLE("venta_id" bigint, "numero" "text", "total" numeric, "estado" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_usuario uuid;
  v_rol text;

  v_venta_id bigint;
  v_numero text;
  v_estado text;

  v_item jsonb;
  v_producto_id bigint;
  v_cantidad numeric(14,2);

  v_producto_nombre text;
  v_unidad_medida text;
  v_precio_venta numeric(14,2);
  v_costo_unitario numeric(14,2);
  v_descuento_pct numeric(5,2);

  v_existencia_anterior numeric(14,2);
  v_existencia_nueva numeric(14,2);

  v_subtotal_linea numeric(14,2);
  v_descuento_linea numeric(14,2);
  v_total_linea numeric(14,2);

  v_subtotal numeric(14,2) := 0;
  v_descuento numeric(14,2) := 0;
  v_total numeric(14,2) := 0;

  v_nombre_cliente text;
  v_permite_credito boolean;

  v_estado_cotizacion text;
BEGIN

  -- ==========================================================
  -- 1. VALIDAR USUARIO
  -- ==========================================================

  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION
      'Usuario no autenticado.';
  END IF;


  -- ==========================================================
  -- 2. VALIDAR ROL
  -- ==========================================================

  v_rol := public.current_role_code();

  
IF COALESCE(v_rol, '') NOT IN (
    'vendedor'
  ) THEN
    
    RAISE EXCEPTION
      'No tiene permisos para registrar ventas.';
  END IF;


  -- ==========================================================
  -- 3. VALIDAR TIPO DE VENTA
  -- ==========================================================

  p_tipo_venta :=
    LOWER(
      TRIM(
        COALESCE(
          p_tipo_venta,
          ''
        )
      )
    );

  IF p_tipo_venta NOT IN (
    'contado',
    'credito'
  ) THEN
    RAISE EXCEPTION
      'El tipo de venta debe ser contado o credito.';
  END IF;


  -- ==========================================================
  -- 4. VALIDAR ITEMS
  -- ==========================================================

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION
      'La venta debe contener al menos un producto.';
  END IF;


  -- No permitir productos repetidos
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        (item ->> 'producto_id')::bigint AS producto_id,
        COUNT(*) AS cantidad_registros
      FROM jsonb_array_elements(p_items) AS t(item)
      GROUP BY
        (item ->> 'producto_id')::bigint
      HAVING COUNT(*) > 1
    ) duplicados
  ) THEN
    RAISE EXCEPTION
      'Un producto no puede repetirse dentro de la misma venta.';
  END IF;


  -- ==========================================================
  -- 5. VALIDAR CLIENTE
  -- ==========================================================

  IF p_cliente_id IS NOT NULL THEN

    SELECT
      c.nombre,
      c.permite_credito
    INTO
      v_nombre_cliente,
      v_permite_credito
    FROM public.clientes c
    WHERE c.id = p_cliente_id
      AND c.activo = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El cliente no existe o se encuentra inactivo.';
    END IF;

  ELSE

    v_nombre_cliente :=
      NULLIF(
        TRIM(
          COALESCE(
            p_cliente_nombre,
            ''
          )
        ),
        ''
      );

    v_permite_credito := false;

  END IF;


  -- ==========================================================
  -- 6. VALIDACIONES PARA VENTA A CRÉDITO
  -- ==========================================================

  IF p_tipo_venta = 'credito' THEN

    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION
        'Las ventas a crédito deben estar asociadas a un cliente registrado.';
    END IF;

    IF COALESCE(v_permite_credito, false) = false THEN
      RAISE EXCEPTION
        'El cliente seleccionado no está autorizado para comprar a crédito.';
    END IF;

    IF p_fecha_vencimiento IS NULL THEN
      RAISE EXCEPTION
        'Debe indicar la fecha de vencimiento de la venta a crédito.';
    END IF;

    IF p_fecha_vencimiento < CURRENT_DATE THEN
      RAISE EXCEPTION
        'La fecha de vencimiento no puede ser anterior a la fecha actual.';
    END IF;

  END IF;


  -- ==========================================================
  -- 7. VALIDAR COTIZACIÓN SI EXISTE
  -- ==========================================================

  IF p_cotizacion_id IS NOT NULL THEN

    SELECT
      c.estado
    INTO
      v_estado_cotizacion
    FROM public.cotizaciones c
    WHERE c.id = p_cotizacion_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'La cotización indicada no existe.';
    END IF;

    IF v_estado_cotizacion NOT IN (
      'emitida',
      'aceptada'
    ) THEN
      RAISE EXCEPTION
        'La cotización no puede convertirse en venta desde su estado actual.';
    END IF;

  END IF;


  -- ==========================================================
  -- 8. VALIDAR PRODUCTOS, STOCK Y CALCULAR TOTAL
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    BEGIN

      v_producto_id :=
        (v_item ->> 'producto_id')::bigint;

      v_cantidad :=
        (v_item ->> 'cantidad')::numeric;

    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Existe un producto con datos inválidos en la venta.';
    END;


    IF v_producto_id IS NULL THEN
      RAISE EXCEPTION
        'Producto inválido.';
    END IF;


    IF v_cantidad IS NULL
       OR v_cantidad <= 0
    THEN
      RAISE EXCEPTION
        'La cantidad debe ser mayor que cero.';
    END IF;


    SELECT
      p.nombre,
      p.unidad_medida,
      p.precio_venta,
      p.precio_compra,
      p.descuento_porcentaje,
      e.cantidad
    INTO
      v_producto_nombre,
      v_unidad_medida,
      v_precio_venta,
      v_costo_unitario,
      v_descuento_pct,
      v_existencia_anterior
    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.id = v_producto_id
      AND p.activo = true
    FOR UPDATE OF e;


    IF NOT FOUND THEN
      RAISE EXCEPTION
        'El producto % no existe, está inactivo o no posee registro de existencia.',
        v_producto_id;
    END IF;


    IF LOWER(TRIM(v_unidad_medida)) = 'unidad'
       AND v_cantidad <> TRUNC(v_cantidad)
    THEN
      RAISE EXCEPTION
        'La cantidad de % debe ser un número entero.',
        v_producto_nombre;
    END IF;


    IF v_existencia_anterior < v_cantidad THEN
      RAISE EXCEPTION
        'Existencia insuficiente para %. Disponible: %, solicitado: %.',
        v_producto_nombre,
        v_existencia_anterior,
        v_cantidad;
    END IF;


    v_subtotal_linea :=
      ROUND(
        v_precio_venta * v_cantidad,
        2
      );


    v_descuento_linea :=
      ROUND(
        v_subtotal_linea *
        (
          COALESCE(v_descuento_pct, 0) / 100
        ),
        2
      );


    v_total_linea :=
      v_subtotal_linea -
      v_descuento_linea;


    v_subtotal :=
      v_subtotal +
      v_subtotal_linea;


    v_descuento :=
      v_descuento +
      v_descuento_linea;


    v_total :=
      v_total +
      v_total_linea;

  END LOOP;


  -- ==========================================================
  -- 9. DEFINIR ESTADO INICIAL
  -- ==========================================================

  IF p_tipo_venta = 'contado' THEN
    v_estado := 'pendiente_cobro';
  ELSE
    v_estado := 'con_saldo';
  END IF;


  -- ==========================================================
  -- 10. GENERAR NÚMERO DE VENTA
  -- ==========================================================

  v_numero :=
    'V-' ||
    LPAD(
      NEXTVAL(
        'public.ventas_numero_seq'
      )::text,
      6,
      '0'
    );


  -- ==========================================================
  -- 11. CREAR VENTA
  -- ==========================================================

  INSERT INTO public.ventas (
    numero,
    cliente_id,
    cliente_nombre,
    cotizacion_id,
    tipo_venta,
    subtotal,
    descuento,
    total,
    estado,
    referencia,
    creada_por
  )
  VALUES (
    v_numero,
    p_cliente_id,
    COALESCE(
      v_nombre_cliente,
      NULLIF(
        TRIM(
          COALESCE(
            p_cliente_nombre,
            ''
          )
        ),
        ''
      )
    ),
    p_cotizacion_id,
    p_tipo_venta,
    v_subtotal,
    v_descuento,
    v_total,
    v_estado,
    NULLIF(
      TRIM(
        COALESCE(
          p_referencia,
          ''
        )
      ),
      ''
    ),
    v_usuario
  )
  RETURNING id
  INTO v_venta_id;


  -- ==========================================================
  -- 12. GUARDAR DETALLE Y DESCONTAR INVENTARIO
  -- ==========================================================

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP

    v_producto_id :=
      (v_item ->> 'producto_id')::bigint;

    v_cantidad :=
      (v_item ->> 'cantidad')::numeric;


    SELECT
      p.nombre,
      p.precio_venta,
      p.precio_compra,
      p.descuento_porcentaje,
      e.cantidad
    INTO
      v_producto_nombre,
      v_precio_venta,
      v_costo_unitario,
      v_descuento_pct,
      v_existencia_anterior
    FROM public.productos p
    JOIN public.existencias e
      ON e.producto_id = p.id
    WHERE p.id = v_producto_id
    FOR UPDATE OF e;


    v_subtotal_linea :=
      ROUND(
        v_precio_venta * v_cantidad,
        2
      );


    v_descuento_linea :=
      ROUND(
        v_subtotal_linea *
        (
          COALESCE(v_descuento_pct, 0) / 100
        ),
        2
      );


    v_total_linea :=
      v_subtotal_linea -
      v_descuento_linea;


    INSERT INTO public.detalle_ventas (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      costo_unitario,
      descuento_porcentaje,
      subtotal
    )
    VALUES (
      v_venta_id,
      v_producto_id,
      v_cantidad,
      v_precio_venta,
      v_costo_unitario,
      COALESCE(
        v_descuento_pct,
        0
      ),
      v_total_linea
    );


    v_existencia_nueva :=
      v_existencia_anterior -
      v_cantidad;


    UPDATE public.existencias
    SET cantidad =
      v_existencia_nueva
    WHERE producto_id =
      v_producto_id;


    INSERT INTO public.movimientos_inventario (
      producto_id,
      tipo,
      cantidad,
      cantidad_anterior,
      cantidad_nueva,
      motivo,
      referencia,
      venta_id,
      creado_por
    )
    VALUES (
      v_producto_id,
      'salida',
      v_cantidad,
      v_existencia_anterior,
      v_existencia_nueva,
      'Venta ' || v_numero,
      v_numero,
      v_venta_id,
      v_usuario
    );

  END LOOP;


  -- ==========================================================
  -- 13. CREAR CUENTA POR COBRAR SI ES CRÉDITO
  -- ==========================================================

  IF p_tipo_venta = 'credito' THEN

    INSERT INTO public.cuentas_por_cobrar (
      venta_id,
      fecha_vencimiento,
      saldo_pendiente,
      estado
    )
    VALUES (
      v_venta_id,
      p_fecha_vencimiento,
      v_total,
      'pendiente'
    );

  END IF;


  -- ==========================================================
  -- 14. MARCAR COTIZACIÓN COMO CONVERTIDA
  -- ==========================================================

  IF p_cotizacion_id IS NOT NULL THEN

    UPDATE public.cotizaciones
    SET estado = 'convertida'
    WHERE id = p_cotizacion_id;

  END IF;


  -- ==========================================================
  -- 15. RESULTADO
  -- ==========================================================

  RETURN QUERY
  SELECT
    v_venta_id,
    v_numero,
    v_total,
    v_estado;

END;
$$;


ALTER FUNCTION "public"."registrar_venta"("p_items" "jsonb", "p_tipo_venta" "text", "p_cliente_id" bigint, "p_cliente_nombre" "text", "p_cotizacion_id" bigint, "p_fecha_vencimiento" "date", "p_referencia" "text") OWNER TO "postgres";


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

  IF COALESCE(v_rol, '') <> 'propietario' THEN
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


ALTER FUNCTION "public"."reportes_propietario"("p_desde" "date", "p_hasta" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tipo_cuenta_actual"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_cliente public.clientes_web%ROWTYPE;
  v_p boolean := false;
  v_c boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 'sin_sesion';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;
  v_p := FOUND;

  SELECT * INTO v_cliente
  FROM public.clientes_web
  WHERE id = v_uid;
  v_c := FOUND;

  IF v_p AND v_c THEN
    RETURN 'conflicto';
  END IF;

  IF v_p THEN
    IF NOT v_profile.activo THEN
      RETURN 'personal_inactivo';
    END IF;
    IF v_profile.role_id IS NULL THEN
      RETURN 'personal_sin_rol';
    END IF;
    RETURN 'personal';
  END IF;

  IF v_c THEN
    IF NOT v_cliente.activo THEN
      RETURN 'cliente_inactivo';
    END IF;
    RETURN 'cliente_web';
  END IF;

  RETURN 'sin_perfil';
END;
$$;


ALTER FUNCTION "public"."tipo_cuenta_actual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_limite_credito"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_cliente_id bigint;
  v_nombre_cliente text;
  v_permite_credito boolean;
  v_limite_credito numeric;
  v_saldo_actual numeric := 0;
BEGIN

  -- Obtener el cliente relacionado con la venta
  SELECT
    v.cliente_id
  INTO
    v_cliente_id
  FROM public.ventas v
  WHERE v.id = NEW.venta_id;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION
      'Una cuenta por cobrar debe estar asociada a un cliente registrado.';
  END IF;


  -- Consultar configuración de crédito del cliente
  SELECT
    c.nombre,
    c.permite_credito,
    c.limite_credito
  INTO
    v_nombre_cliente,
    v_permite_credito,
    v_limite_credito
  FROM public.clientes c
  WHERE c.id = v_cliente_id
    AND c.activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'El cliente asociado no existe o está inactivo.';
  END IF;


  IF COALESCE(v_permite_credito, false) = false THEN
    RAISE EXCEPTION
      'El cliente % no está autorizado para comprar a crédito.',
      v_nombre_cliente;
  END IF;


  IF v_limite_credito IS NULL
     OR v_limite_credito <= 0
  THEN
    RAISE EXCEPTION
      'El cliente % no tiene un límite de crédito válido.',
      v_nombre_cliente;
  END IF;


  -- Calcular deuda actual, excluyendo la cuenta que se esté modificando
  SELECT
    COALESCE(SUM(cxc.saldo_pendiente), 0)
  INTO
    v_saldo_actual
  FROM public.cuentas_por_cobrar cxc
  JOIN public.ventas v
    ON v.id = cxc.venta_id
  WHERE v.cliente_id = v_cliente_id
    AND cxc.saldo_pendiente > 0
    AND (
      TG_OP = 'INSERT'
      OR cxc.id <> NEW.id
    );


  IF v_saldo_actual + NEW.saldo_pendiente > v_limite_credito THEN
    RAISE EXCEPTION
      'La operación supera el límite de crédito del cliente %. Límite: C$%, saldo actual: C$%, nueva deuda: C$%.',
      v_nombre_cliente,
      v_limite_credito,
      v_saldo_actual,
      NEW.saldo_pendiente;
  END IF;


  RETURN NEW;

END;
$_$;


ALTER FUNCTION "public"."validar_limite_credito"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vincular_movimiento_inventario"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.recepcion_compra_id IS NULL
     AND NEW.referencia LIKE 'RC-%'
  THEN
    SELECT rc.id
    INTO NEW.recepcion_compra_id
    FROM public.recepciones_compra rc
    WHERE rc.numero = NEW.referencia;
  END IF;

  IF NEW.devolucion_compra_id IS NULL
     AND NEW.referencia LIKE 'DC-%'
  THEN
    SELECT dc.id
    INTO NEW.devolucion_compra_id
    FROM public.devoluciones_compra dc
    WHERE dc.numero = NEW.referencia;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."vincular_movimiento_inventario"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."arqueos_caja" (
    "id" bigint NOT NULL,
    "sesion_caja_id" bigint NOT NULL,
    "efectivo_esperado" numeric(14,2) NOT NULL,
    "efectivo_contado" numeric(14,2) NOT NULL,
    "diferencia" numeric(14,2) NOT NULL,
    "observaciones" "text",
    "realizado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "arqueos_caja_efectivo_contado_check" CHECK (("efectivo_contado" >= (0)::numeric)),
    CONSTRAINT "arqueos_caja_efectivo_esperado_check" CHECK (("efectivo_esperado" >= (0)::numeric))
);


ALTER TABLE "public"."arqueos_caja" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."arqueos_caja_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."arqueos_caja_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."arqueos_caja_id_seq" OWNED BY "public"."arqueos_caja"."id";



CREATE TABLE IF NOT EXISTS "public"."categorias" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categorias_nombre_no_vacio" CHECK (("length"(TRIM(BOTH FROM "nombre")) > 0))
);


ALTER TABLE "public"."categorias" OWNER TO "postgres";


ALTER TABLE "public"."categorias" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."categorias_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" bigint NOT NULL,
    "codigo" "text" NOT NULL,
    "tipo_cliente" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "identificacion" "text",
    "telefono" "text",
    "correo" "text",
    "direccion" "text",
    "permite_credito" boolean DEFAULT false NOT NULL,
    "limite_credito" numeric(14,2),
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clientes_limite_credito_check" CHECK ((("limite_credito" IS NULL) OR ("limite_credito" >= (0)::numeric))),
    CONSTRAINT "clientes_tipo_cliente_check" CHECK (("tipo_cliente" = ANY (ARRAY['natural'::"text", 'juridica'::"text"])))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."clientes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."clientes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."clientes_id_seq" OWNED BY "public"."clientes"."id";



CREATE TABLE IF NOT EXISTS "public"."clientes_web" (
    "id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "correo" "text" NOT NULL,
    "telefono" "text",
    "direccion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clientes_web_nombre_check" CHECK (("length"(TRIM(BOTH FROM "nombre")) >= 2))
);


ALTER TABLE "public"."clientes_web" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."colores" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "colores_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) >= 1))
);


ALTER TABLE "public"."colores" OWNER TO "postgres";


ALTER TABLE "public"."colores" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."colores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."compra_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."compra_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compras" (
    "id" bigint NOT NULL,
    "numero" "text" DEFAULT ('C-'::"text" || "lpad"(("nextval"('"public"."compra_numero_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "proveedor_id" bigint NOT NULL,
    "fecha_compra" "date" DEFAULT CURRENT_DATE NOT NULL,
    "referencia_documento" "text",
    "observaciones" "text",
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'registrada'::"text" NOT NULL,
    "creado_por" "uuid",
    "anulada_por" "uuid",
    "anulada_at" timestamp with time zone,
    "motivo_anulacion" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo_compra" "text" DEFAULT 'directa'::"text" NOT NULL,
    "autorizada_por" "uuid",
    "autorizada_at" timestamp with time zone,
    CONSTRAINT "compras_estado_check" CHECK (("estado" = ANY (ARRAY['registrada'::"text", 'autorizada'::"text", 'recibida'::"text", 'anulada'::"text"]))),
    CONSTRAINT "compras_tipo_compra_check" CHECK (("tipo_compra" = ANY (ARRAY['directa'::"text", 'cotizacion'::"text", 'licitacion'::"text"]))),
    CONSTRAINT "compras_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."compras" OWNER TO "postgres";


ALTER TABLE "public"."compras" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."compras_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cotizaciones" (
    "id" bigint NOT NULL,
    "numero" "text" NOT NULL,
    "cliente_id" bigint,
    "cliente_nombre" "text",
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "descuento" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'borrador'::"text" NOT NULL,
    "vigencia_hasta" "date",
    "observaciones" "text",
    "creada_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cotizaciones_descuento_check" CHECK (("descuento" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_estado_check" CHECK (("estado" = ANY (ARRAY['borrador'::"text", 'emitida'::"text", 'aceptada'::"text", 'rechazada'::"text", 'vencida'::"text", 'convertida'::"text"]))),
    CONSTRAINT "cotizaciones_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "cotizaciones_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."cotizaciones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cotizaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cotizaciones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cotizaciones_id_seq" OWNED BY "public"."cotizaciones"."id";



CREATE TABLE IF NOT EXISTS "public"."cuentas_por_cobrar" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "fecha_vencimiento" "date" NOT NULL,
    "saldo_pendiente" numeric(14,2) NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cuentas_por_cobrar_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'pagada'::"text", 'vencida'::"text"]))),
    CONSTRAINT "cuentas_por_cobrar_saldo_pendiente_check" CHECK (("saldo_pendiente" >= (0)::numeric))
);


ALTER TABLE "public"."cuentas_por_cobrar" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cuentas_por_cobrar_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cuentas_por_cobrar_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cuentas_por_cobrar_id_seq" OWNED BY "public"."cuentas_por_cobrar"."id";



CREATE TABLE IF NOT EXISTS "public"."detalle_compras" (
    "id" bigint NOT NULL,
    "compra_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(14,2) NOT NULL,
    "costo_unitario" numeric(14,2) NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "detalle_compras_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "detalle_compras_costo_check" CHECK (("costo_unitario" >= (0)::numeric)),
    CONSTRAINT "detalle_compras_subtotal_check" CHECK (("subtotal" >= (0)::numeric))
);


ALTER TABLE "public"."detalle_compras" OWNER TO "postgres";


ALTER TABLE "public"."detalle_compras" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."detalle_compras_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."detalle_cotizaciones" (
    "id" bigint NOT NULL,
    "cotizacion_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(14,2) NOT NULL,
    "precio_unitario" numeric(14,2) NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    CONSTRAINT "detalle_cotizaciones_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "detalle_cotizaciones_precio_unitario_check" CHECK (("precio_unitario" >= (0)::numeric)),
    CONSTRAINT "detalle_cotizaciones_subtotal_check" CHECK (("subtotal" >= (0)::numeric))
);


ALTER TABLE "public"."detalle_cotizaciones" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."detalle_cotizaciones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."detalle_cotizaciones_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."detalle_cotizaciones_id_seq" OWNED BY "public"."detalle_cotizaciones"."id";



CREATE TABLE IF NOT EXISTS "public"."detalle_devoluciones_compra" (
    "id" bigint NOT NULL,
    "devolucion_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad_devuelta" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "detalle_devoluciones_compra_cantidad_check" CHECK (("cantidad_devuelta" > (0)::numeric))
);


ALTER TABLE "public"."detalle_devoluciones_compra" OWNER TO "postgres";


ALTER TABLE "public"."detalle_devoluciones_compra" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."detalle_devoluciones_compra_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."detalle_devoluciones_venta" (
    "id" bigint NOT NULL,
    "devolucion_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(14,2) NOT NULL,
    "precio_unitario" numeric(14,2) NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    "destino" "text" DEFAULT 'inventario'::"text" NOT NULL,
    "observaciones" "text",
    CONSTRAINT "detalle_devoluciones_venta_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "detalle_devoluciones_venta_destino_check" CHECK (("destino" = ANY (ARRAY['inventario'::"text", 'merma'::"text"]))),
    CONSTRAINT "detalle_devoluciones_venta_precio_unitario_check" CHECK (("precio_unitario" >= (0)::numeric)),
    CONSTRAINT "detalle_devoluciones_venta_subtotal_check" CHECK (("subtotal" >= (0)::numeric))
);


ALTER TABLE "public"."detalle_devoluciones_venta" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."detalle_devoluciones_venta_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."detalle_devoluciones_venta_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."detalle_devoluciones_venta_id_seq" OWNED BY "public"."detalle_devoluciones_venta"."id";



CREATE TABLE IF NOT EXISTS "public"."detalle_pedidos_en_linea" (
    "id" bigint NOT NULL,
    "pedido_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(14,2) NOT NULL,
    "precio_unitario" numeric(14,2) NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    CONSTRAINT "detalle_pedidos_en_linea_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "detalle_pedidos_en_linea_precio_unitario_check" CHECK (("precio_unitario" >= (0)::numeric)),
    CONSTRAINT "detalle_pedidos_en_linea_subtotal_check" CHECK (("subtotal" >= (0)::numeric))
);


ALTER TABLE "public"."detalle_pedidos_en_linea" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."detalle_pedidos_en_linea_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."detalle_pedidos_en_linea_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."detalle_pedidos_en_linea_id_seq" OWNED BY "public"."detalle_pedidos_en_linea"."id";



CREATE TABLE IF NOT EXISTS "public"."detalle_recepciones_compra" (
    "id" bigint NOT NULL,
    "recepcion_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad_recibida" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "detalle_recepcion_cantidad_check" CHECK (("cantidad_recibida" > (0)::numeric))
);


ALTER TABLE "public"."detalle_recepciones_compra" OWNER TO "postgres";


ALTER TABLE "public"."detalle_recepciones_compra" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."detalle_recepciones_compra_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."detalle_ventas" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(14,2) NOT NULL,
    "precio_unitario" numeric(14,2) NOT NULL,
    "subtotal" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "costo_unitario" numeric(14,2),
    "descuento_porcentaje" numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "detalle_ventas_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "detalle_ventas_costo_unitario_check" CHECK ((("costo_unitario" IS NULL) OR ("costo_unitario" >= (0)::numeric))),
    CONSTRAINT "detalle_ventas_descuento_porcentaje_check" CHECK ((("descuento_porcentaje" >= (0)::numeric) AND ("descuento_porcentaje" <= (100)::numeric))),
    CONSTRAINT "detalle_ventas_precio_unitario_check" CHECK (("precio_unitario" >= (0)::numeric)),
    CONSTRAINT "detalle_ventas_subtotal_check" CHECK (("subtotal" >= (0)::numeric))
);


ALTER TABLE "public"."detalle_ventas" OWNER TO "postgres";


ALTER TABLE "public"."detalle_ventas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."detalle_ventas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."devolucion_compra_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."devolucion_compra_numero_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."devolucion_venta_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."devolucion_venta_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devoluciones_compra" (
    "id" bigint NOT NULL,
    "numero" "text" DEFAULT ('DC-'::"text" || "lpad"(("nextval"('"public"."devolucion_compra_numero_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "compra_id" bigint NOT NULL,
    "fecha_devolucion" "date" DEFAULT CURRENT_DATE NOT NULL,
    "motivo" "text" NOT NULL,
    "observaciones" "text",
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "devoluciones_compra_motivo_check" CHECK (("length"(TRIM(BOTH FROM "motivo")) >= 3))
);


ALTER TABLE "public"."devoluciones_compra" OWNER TO "postgres";


ALTER TABLE "public"."devoluciones_compra" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."devoluciones_compra_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."devoluciones_venta" (
    "id" bigint NOT NULL,
    "numero" "text" NOT NULL,
    "venta_id" bigint NOT NULL,
    "motivo" "text" NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'registrada'::"text" NOT NULL,
    "observaciones" "text",
    "creada_por" "uuid" NOT NULL,
    "confirmada_at" timestamp with time zone,
    "confirmada_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado_financiero" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "monto_aplicado_cxc" numeric(14,2) DEFAULT 0 NOT NULL,
    "monto_reembolso" numeric(14,2) DEFAULT 0 NOT NULL,
    "procesada_financieramente_at" timestamp with time zone,
    "procesada_financieramente_por" "uuid",
    "reembolsada_at" timestamp with time zone,
    "reembolsada_por" "uuid",
    CONSTRAINT "devoluciones_venta_estado_check" CHECK (("estado" = ANY (ARRAY['registrada'::"text", 'confirmada'::"text", 'anulada'::"text"]))),
    CONSTRAINT "devoluciones_venta_estado_financiero_check" CHECK (("estado_financiero" = ANY (ARRAY['pendiente'::"text", 'aplicada_cxc'::"text", 'pendiente_reembolso'::"text", 'reembolsada'::"text"]))),
    CONSTRAINT "devoluciones_venta_monto_aplicado_cxc_check" CHECK (("monto_aplicado_cxc" >= (0)::numeric)),
    CONSTRAINT "devoluciones_venta_monto_reembolso_check" CHECK (("monto_reembolso" >= (0)::numeric)),
    CONSTRAINT "devoluciones_venta_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."devoluciones_venta" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."devoluciones_venta_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."devoluciones_venta_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."devoluciones_venta_id_seq" OWNED BY "public"."devoluciones_venta"."id";



CREATE TABLE IF NOT EXISTS "public"."existencias" (
    "producto_id" bigint NOT NULL,
    "cantidad" numeric(12,2) DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "existencias_cantidad_valida" CHECK (("cantidad" >= (0)::numeric))
);


ALTER TABLE "public"."existencias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marcas" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "marcas_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) >= 1))
);


ALTER TABLE "public"."marcas" OWNER TO "postgres";


ALTER TABLE "public"."marcas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."marcas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."materiales" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "materiales_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) >= 1))
);


ALTER TABLE "public"."materiales" OWNER TO "postgres";


ALTER TABLE "public"."materiales" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."materiales_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."modelos" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "modelos_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) >= 1))
);


ALTER TABLE "public"."modelos" OWNER TO "postgres";


ALTER TABLE "public"."modelos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."modelos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."movimientos_caja" (
    "id" bigint NOT NULL,
    "venta_id" bigint,
    "tipo" "text" NOT NULL,
    "concepto" "text" NOT NULL,
    "metodo_pago" "text",
    "monto" numeric(14,2) NOT NULL,
    "referencia" "text",
    "creado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sesion_caja_id" bigint,
    "pago_venta_id" bigint,
    "devolucion_venta_id" bigint,
    CONSTRAINT "movimientos_caja_metodo_pago_check" CHECK ((("metodo_pago" IS NULL) OR ("metodo_pago" = ANY (ARRAY['efectivo'::"text", 'tarjeta'::"text", 'transferencia'::"text"])))),
    CONSTRAINT "movimientos_caja_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "movimientos_caja_tipo_check" CHECK (("tipo" = ANY (ARRAY['ingreso'::"text", 'egreso'::"text", 'ajuste'::"text"])))
);


ALTER TABLE "public"."movimientos_caja" OWNER TO "postgres";


ALTER TABLE "public"."movimientos_caja" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."movimientos_caja_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."movimientos_inventario" (
    "id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "cantidad" numeric(12,2) NOT NULL,
    "cantidad_anterior" numeric(12,2) NOT NULL,
    "cantidad_nueva" numeric(12,2) NOT NULL,
    "motivo" "text",
    "referencia" "text",
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "venta_id" bigint,
    "recepcion_compra_id" bigint,
    "devolucion_compra_id" bigint,
    "devolucion_venta_id" bigint,
    CONSTRAINT "movimientos_cantidad_anterior_valida" CHECK (("cantidad_anterior" >= (0)::numeric)),
    CONSTRAINT "movimientos_cantidad_nueva_valida" CHECK (("cantidad_nueva" >= (0)::numeric)),
    CONSTRAINT "movimientos_cantidad_valida" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "movimientos_tipo_valido" CHECK (("tipo" = ANY (ARRAY['entrada'::"text", 'salida'::"text", 'ajuste_positivo'::"text", 'ajuste_negativo'::"text"])))
);


ALTER TABLE "public"."movimientos_inventario" OWNER TO "postgres";


ALTER TABLE "public"."movimientos_inventario" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."movimientos_inventario_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pagos_venta" (
    "id" bigint NOT NULL,
    "venta_id" bigint NOT NULL,
    "metodo_pago" "text" NOT NULL,
    "monto" numeric(14,2) NOT NULL,
    "monto_recibido" numeric(14,2),
    "cambio" numeric(14,2) DEFAULT 0 NOT NULL,
    "referencia" "text",
    "creado_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pagos_venta_cambio_check" CHECK (("cambio" >= (0)::numeric)),
    CONSTRAINT "pagos_venta_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['efectivo'::"text", 'tarjeta'::"text", 'transferencia'::"text"]))),
    CONSTRAINT "pagos_venta_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."pagos_venta" OWNER TO "postgres";


ALTER TABLE "public"."pagos_venta" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."pagos_venta_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."pedido_web_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pedido_web_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedidos_en_linea" (
    "id" bigint NOT NULL,
    "numero" "text" NOT NULL,
    "cliente_id" bigint,
    "cliente_nombre" "text" NOT NULL,
    "telefono" "text",
    "correo" "text",
    "modalidad_entrega" "text" DEFAULT 'retiro'::"text" NOT NULL,
    "direccion_entrega" "text",
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "descuento" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'recibido'::"text" NOT NULL,
    "observaciones" "text",
    "venta_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cliente_web_id" "uuid",
    "motivo_estado" "text",
    "gestionado_por" "uuid",
    "gestionado_at" timestamp with time zone,
    CONSTRAINT "pedidos_en_linea_descuento_check" CHECK (("descuento" >= (0)::numeric)),
    CONSTRAINT "pedidos_en_linea_estado_check" CHECK (("estado" = ANY (ARRAY['recibido'::"text", 'confirmado'::"text", 'rechazado'::"text", 'preparado'::"text", 'convertido'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "pedidos_en_linea_modalidad_entrega_check" CHECK (("modalidad_entrega" = ANY (ARRAY['retiro'::"text", 'domicilio'::"text"]))),
    CONSTRAINT "pedidos_en_linea_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "pedidos_en_linea_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."pedidos_en_linea" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pedidos_en_linea_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pedidos_en_linea_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pedidos_en_linea_id_seq" OWNED BY "public"."pedidos_en_linea"."id";



CREATE TABLE IF NOT EXISTS "public"."productos" (
    "id" bigint NOT NULL,
    "codigo" "text" NOT NULL,
    "codigo_barras" "text",
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "categoria_id" bigint,
    "unidad_medida" "text" DEFAULT 'unidad'::"text" NOT NULL,
    "precio_compra" numeric(12,2) DEFAULT 0 NOT NULL,
    "precio_venta" numeric(12,2) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(12,2) DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "marca_id" bigint,
    "modelo_id" bigint,
    "color_id" bigint,
    "material_id" bigint,
    "unidad_medida_id" bigint,
    "stock_maximo" numeric(12,2),
    "descuento_porcentaje" numeric(5,2) DEFAULT 0 NOT NULL,
    "imagen_url" "text",
    CONSTRAINT "productos_codigo_no_vacio" CHECK (("length"(TRIM(BOTH FROM "codigo")) > 0)),
    CONSTRAINT "productos_descuento_porcentaje_check" CHECK ((("descuento_porcentaje" >= (0)::numeric) AND ("descuento_porcentaje" <= (100)::numeric))),
    CONSTRAINT "productos_nombre_no_vacio" CHECK (("length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "productos_precio_compra_valido" CHECK (("precio_compra" >= (0)::numeric)),
    CONSTRAINT "productos_precio_venta_valido" CHECK (("precio_venta" >= (0)::numeric)),
    CONSTRAINT "productos_stock_maximo_check" CHECK ((("stock_maximo" IS NULL) OR ("stock_maximo" >= (0)::numeric))),
    CONSTRAINT "productos_stock_minimo_valido" CHECK (("stock_minimo" >= (0)::numeric))
);


ALTER TABLE "public"."productos" OWNER TO "postgres";


ALTER TABLE "public"."productos" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."productos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "nombre_completo" "text",
    "role_id" bigint,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."proveedor_codigo_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."proveedor_codigo_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proveedor_productos" (
    "id" bigint NOT NULL,
    "proveedor_id" bigint NOT NULL,
    "producto_id" bigint NOT NULL,
    "codigo_proveedor" "text",
    "ultimo_costo" numeric(14,2),
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "proveedor_productos_ultimo_costo_check" CHECK ((("ultimo_costo" IS NULL) OR ("ultimo_costo" >= (0)::numeric)))
);


ALTER TABLE "public"."proveedor_productos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."proveedor_productos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."proveedor_productos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."proveedor_productos_id_seq" OWNED BY "public"."proveedor_productos"."id";



CREATE TABLE IF NOT EXISTS "public"."proveedores" (
    "id" bigint NOT NULL,
    "codigo" "text" DEFAULT ('PROV-'::"text" || "lpad"(("nextval"('"public"."proveedor_codigo_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "nombre" "text" NOT NULL,
    "ruc" "text",
    "contacto" "text",
    "telefono" "text",
    "email" "text",
    "direccion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "proveedores_nombre_check" CHECK (("length"(TRIM(BOTH FROM "nombre")) >= 2))
);


ALTER TABLE "public"."proveedores" OWNER TO "postgres";


ALTER TABLE "public"."proveedores" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."proveedores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."recepcion_compra_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."recepcion_compra_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recepciones_compra" (
    "id" bigint NOT NULL,
    "numero" "text" DEFAULT ('RC-'::"text" || "lpad"(("nextval"('"public"."recepcion_compra_numero_seq"'::"regclass"))::"text", 6, '0'::"text")) NOT NULL,
    "compra_id" bigint NOT NULL,
    "fecha_recepcion" "date" DEFAULT CURRENT_DATE NOT NULL,
    "observaciones" "text",
    "recibido_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recepciones_compra" OWNER TO "postgres";


ALTER TABLE "public"."recepciones_compra" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."recepciones_compra_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" bigint NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


ALTER TABLE "public"."roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."sesion_caja_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sesion_caja_numero_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sesiones_caja" (
    "id" bigint NOT NULL,
    "numero" "text" NOT NULL,
    "abierta_por" "uuid" NOT NULL,
    "fecha_apertura" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monto_inicial" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'abierta'::"text" NOT NULL,
    "fecha_cierre" timestamp with time zone,
    "cerrada_por" "uuid",
    "observaciones_apertura" "text",
    "observaciones_cierre" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sesiones_caja_estado_check" CHECK (("estado" = ANY (ARRAY['abierta'::"text", 'cerrada'::"text"]))),
    CONSTRAINT "sesiones_caja_monto_inicial_check" CHECK (("monto_inicial" >= (0)::numeric))
);


ALTER TABLE "public"."sesiones_caja" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sesiones_caja_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sesiones_caja_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sesiones_caja_id_seq" OWNED BY "public"."sesiones_caja"."id";



CREATE TABLE IF NOT EXISTS "public"."unidades_medida" (
    "id" bigint NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "unidades_medida_nombre_check" CHECK (("char_length"(TRIM(BOTH FROM "nombre")) >= 1))
);


ALTER TABLE "public"."unidades_medida" OWNER TO "postgres";


ALTER TABLE "public"."unidades_medida" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."unidades_medida_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ventas" (
    "id" bigint NOT NULL,
    "numero" "text" NOT NULL,
    "cliente_nombre" "text",
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "descuento" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'pendiente_cobro'::"text" NOT NULL,
    "referencia" "text",
    "creada_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anulada_at" timestamp with time zone,
    "anulada_por" "uuid",
    "motivo_anulacion" "text",
    "cliente_id" bigint,
    "cotizacion_id" bigint,
    "tipo_venta" "text" DEFAULT 'contado'::"text" NOT NULL,
    CONSTRAINT "ventas_descuento_check" CHECK (("descuento" >= (0)::numeric)),
    CONSTRAINT "ventas_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente_cobro'::"text", 'con_saldo'::"text", 'pagada'::"text", 'anulada'::"text", 'completada'::"text"]))),
    CONSTRAINT "ventas_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "ventas_tipo_venta_check" CHECK (("tipo_venta" = ANY (ARRAY['contado'::"text", 'credito'::"text"]))),
    CONSTRAINT "ventas_total_check" CHECK (("total" >= (0)::numeric))
);


ALTER TABLE "public"."ventas" OWNER TO "postgres";


ALTER TABLE "public"."ventas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ventas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE SEQUENCE IF NOT EXISTS "public"."ventas_numero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ventas_numero_seq" OWNER TO "postgres";


ALTER TABLE ONLY "public"."arqueos_caja" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."arqueos_caja_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."clientes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."clientes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cotizaciones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cotizaciones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cuentas_por_cobrar" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cuentas_por_cobrar_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."detalle_cotizaciones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."detalle_cotizaciones_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."detalle_devoluciones_venta" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."detalle_devoluciones_venta_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."detalle_pedidos_en_linea" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."detalle_pedidos_en_linea_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."devoluciones_venta" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."devoluciones_venta_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pedidos_en_linea" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pedidos_en_linea_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."proveedor_productos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."proveedor_productos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sesiones_caja" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sesiones_caja_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."arqueos_caja"
    ADD CONSTRAINT "arqueos_caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."arqueos_caja"
    ADD CONSTRAINT "arqueos_caja_sesion_caja_id_key" UNIQUE ("sesion_caja_id");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes_web"
    ADD CONSTRAINT "clientes_web_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."colores"
    ADD CONSTRAINT "colores_nombre_unique" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."colores"
    ADD CONSTRAINT "colores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_venta_id_key" UNIQUE ("venta_id");



ALTER TABLE ONLY "public"."detalle_compras"
    ADD CONSTRAINT "detalle_compras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_compras"
    ADD CONSTRAINT "detalle_compras_producto_unico" UNIQUE ("compra_id", "producto_id");



ALTER TABLE ONLY "public"."detalle_cotizaciones"
    ADD CONSTRAINT "detalle_cotizaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_devoluciones_compra"
    ADD CONSTRAINT "detalle_devoluciones_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_devoluciones_compra"
    ADD CONSTRAINT "detalle_devoluciones_compra_unique" UNIQUE ("devolucion_id", "producto_id");



ALTER TABLE ONLY "public"."detalle_devoluciones_venta"
    ADD CONSTRAINT "detalle_devoluciones_venta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_pedidos_en_linea"
    ADD CONSTRAINT "detalle_pedidos_en_linea_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_recepciones_compra"
    ADD CONSTRAINT "detalle_recepcion_producto_unique" UNIQUE ("recepcion_id", "producto_id");



ALTER TABLE ONLY "public"."detalle_recepciones_compra"
    ADD CONSTRAINT "detalle_recepciones_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."detalle_ventas"
    ADD CONSTRAINT "detalle_ventas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones_compra"
    ADD CONSTRAINT "devoluciones_compra_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."devoluciones_compra"
    ADD CONSTRAINT "devoluciones_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."existencias"
    ADD CONSTRAINT "existencias_pkey" PRIMARY KEY ("producto_id");



ALTER TABLE ONLY "public"."marcas"
    ADD CONSTRAINT "marcas_nombre_unique" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."marcas"
    ADD CONSTRAINT "marcas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."materiales"
    ADD CONSTRAINT "materiales_nombre_unique" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."materiales"
    ADD CONSTRAINT "materiales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modelos"
    ADD CONSTRAINT "modelos_nombre_unique" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."modelos"
    ADD CONSTRAINT "modelos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagos_venta"
    ADD CONSTRAINT "pagos_venta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_venta_id_key" UNIQUE ("venta_id");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedor_productos"
    ADD CONSTRAINT "proveedor_productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedor_productos"
    ADD CONSTRAINT "proveedor_productos_unique" UNIQUE ("proveedor_id", "producto_id");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."proveedores"
    ADD CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_compra_id_key" UNIQUE ("compra_id");



ALTER TABLE ONLY "public"."recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sesiones_caja"
    ADD CONSTRAINT "sesiones_caja_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."sesiones_caja"
    ADD CONSTRAINT "sesiones_caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unidades_medida"
    ADD CONSTRAINT "unidades_medida_nombre_unique" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."unidades_medida"
    ADD CONSTRAINT "unidades_medida_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_numero_key" UNIQUE ("numero");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_pkey" PRIMARY KEY ("id");



CREATE INDEX "categorias_activo_idx" ON "public"."categorias" USING "btree" ("activo");



CREATE UNIQUE INDEX "categorias_nombre_unique_idx" ON "public"."categorias" USING "btree" ("lower"("nombre"));



CREATE UNIQUE INDEX "clientes_web_correo_unique" ON "public"."clientes_web" USING "btree" ("lower"("correo"));



CREATE INDEX "existencias_cantidad_idx" ON "public"."existencias" USING "btree" ("cantidad");



CREATE INDEX "idx_arqueos_caja_sesion" ON "public"."arqueos_caja" USING "btree" ("sesion_caja_id");



CREATE INDEX "idx_compras_estado" ON "public"."compras" USING "btree" ("estado");



CREATE INDEX "idx_compras_fecha" ON "public"."compras" USING "btree" ("fecha_compra");



CREATE INDEX "idx_compras_proveedor" ON "public"."compras" USING "btree" ("proveedor_id");



CREATE INDEX "idx_cotizaciones_cliente_id" ON "public"."cotizaciones" USING "btree" ("cliente_id");



CREATE INDEX "idx_cuentas_por_cobrar_estado" ON "public"."cuentas_por_cobrar" USING "btree" ("estado");



CREATE INDEX "idx_cuentas_por_cobrar_venta_id" ON "public"."cuentas_por_cobrar" USING "btree" ("venta_id");



CREATE INDEX "idx_detalle_compras_compra" ON "public"."detalle_compras" USING "btree" ("compra_id");



CREATE INDEX "idx_detalle_compras_producto" ON "public"."detalle_compras" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_cotizaciones_cotizacion_id" ON "public"."detalle_cotizaciones" USING "btree" ("cotizacion_id");



CREATE INDEX "idx_detalle_cotizaciones_producto_id" ON "public"."detalle_cotizaciones" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_devoluciones_producto" ON "public"."detalle_devoluciones_compra" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_devoluciones_venta_devolucion_id" ON "public"."detalle_devoluciones_venta" USING "btree" ("devolucion_id");



CREATE INDEX "idx_detalle_devoluciones_venta_producto_id" ON "public"."detalle_devoluciones_venta" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_pedidos_pedido_id" ON "public"."detalle_pedidos_en_linea" USING "btree" ("pedido_id");



CREATE INDEX "idx_detalle_pedidos_producto_id" ON "public"."detalle_pedidos_en_linea" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_recepcion_producto_id" ON "public"."detalle_recepciones_compra" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_ventas_producto" ON "public"."detalle_ventas" USING "btree" ("producto_id");



CREATE INDEX "idx_detalle_ventas_venta" ON "public"."detalle_ventas" USING "btree" ("venta_id");



CREATE INDEX "idx_devoluciones_compra_compra" ON "public"."devoluciones_compra" USING "btree" ("compra_id");



CREATE INDEX "idx_devoluciones_compra_fecha" ON "public"."devoluciones_compra" USING "btree" ("fecha_devolucion");



CREATE INDEX "idx_devoluciones_venta_estado" ON "public"."devoluciones_venta" USING "btree" ("estado");



CREATE INDEX "idx_devoluciones_venta_venta_id" ON "public"."devoluciones_venta" USING "btree" ("venta_id");



CREATE INDEX "idx_mov_inv_devolucion_compra" ON "public"."movimientos_inventario" USING "btree" ("devolucion_compra_id");



CREATE INDEX "idx_mov_inv_devolucion_venta" ON "public"."movimientos_inventario" USING "btree" ("devolucion_venta_id");



CREATE INDEX "idx_mov_inv_recepcion" ON "public"."movimientos_inventario" USING "btree" ("recepcion_compra_id");



CREATE INDEX "idx_mov_inv_venta" ON "public"."movimientos_inventario" USING "btree" ("venta_id");



CREATE INDEX "idx_movimientos_caja_devolucion_venta_id" ON "public"."movimientos_caja" USING "btree" ("devolucion_venta_id");



CREATE INDEX "idx_movimientos_caja_fecha" ON "public"."movimientos_caja" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "idx_movimientos_caja_pago_venta_id" ON "public"."movimientos_caja" USING "btree" ("pago_venta_id") WHERE ("pago_venta_id" IS NOT NULL);



CREATE INDEX "idx_movimientos_caja_sesion_caja_id" ON "public"."movimientos_caja" USING "btree" ("sesion_caja_id");



CREATE INDEX "idx_movimientos_caja_venta" ON "public"."movimientos_caja" USING "btree" ("venta_id");



CREATE INDEX "idx_pagos_venta_venta" ON "public"."pagos_venta" USING "btree" ("venta_id");



CREATE INDEX "idx_pedidos_en_linea_cliente_id" ON "public"."pedidos_en_linea" USING "btree" ("cliente_id");



CREATE INDEX "idx_pedidos_en_linea_cliente_web" ON "public"."pedidos_en_linea" USING "btree" ("cliente_web_id");



CREATE INDEX "idx_pedidos_en_linea_estado" ON "public"."pedidos_en_linea" USING "btree" ("estado");



CREATE INDEX "idx_productos_color_id" ON "public"."productos" USING "btree" ("color_id");



CREATE INDEX "idx_productos_marca_id" ON "public"."productos" USING "btree" ("marca_id");



CREATE INDEX "idx_productos_material_id" ON "public"."productos" USING "btree" ("material_id");



CREATE INDEX "idx_productos_modelo_id" ON "public"."productos" USING "btree" ("modelo_id");



CREATE INDEX "idx_productos_unidad_medida_id" ON "public"."productos" USING "btree" ("unidad_medida_id");



CREATE INDEX "idx_proveedor_productos_producto" ON "public"."proveedor_productos" USING "btree" ("producto_id");



CREATE INDEX "idx_proveedor_productos_proveedor" ON "public"."proveedor_productos" USING "btree" ("proveedor_id");



CREATE INDEX "idx_proveedores_activo" ON "public"."proveedores" USING "btree" ("activo");



CREATE INDEX "idx_proveedores_nombre" ON "public"."proveedores" USING "btree" ("nombre");



CREATE INDEX "idx_recepciones_compra_compra_id" ON "public"."recepciones_compra" USING "btree" ("compra_id");



CREATE INDEX "idx_sesiones_caja_abierta_por" ON "public"."sesiones_caja" USING "btree" ("abierta_por");



CREATE INDEX "idx_sesiones_caja_estado" ON "public"."sesiones_caja" USING "btree" ("estado");



CREATE INDEX "idx_ventas_cliente_id" ON "public"."ventas" USING "btree" ("cliente_id");



CREATE UNIQUE INDEX "idx_ventas_cotizacion_id_unique" ON "public"."ventas" USING "btree" ("cotizacion_id") WHERE ("cotizacion_id" IS NOT NULL);



CREATE INDEX "idx_ventas_creada_por" ON "public"."ventas" USING "btree" ("creada_por");



CREATE INDEX "idx_ventas_created_at" ON "public"."ventas" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_ventas_estado" ON "public"."ventas" USING "btree" ("estado");



CREATE INDEX "movimientos_fecha_idx" ON "public"."movimientos_inventario" USING "btree" ("created_at" DESC);



CREATE INDEX "movimientos_producto_idx" ON "public"."movimientos_inventario" USING "btree" ("producto_id");



CREATE INDEX "movimientos_tipo_idx" ON "public"."movimientos_inventario" USING "btree" ("tipo");



CREATE INDEX "movimientos_usuario_idx" ON "public"."movimientos_inventario" USING "btree" ("creado_por");



CREATE INDEX "productos_activo_idx" ON "public"."productos" USING "btree" ("activo");



CREATE INDEX "productos_categoria_idx" ON "public"."productos" USING "btree" ("categoria_id");



CREATE UNIQUE INDEX "productos_codigo_barras_unique_idx" ON "public"."productos" USING "btree" ("codigo_barras") WHERE ("codigo_barras" IS NOT NULL);



CREATE UNIQUE INDEX "productos_codigo_unique_idx" ON "public"."productos" USING "btree" ("lower"("codigo"));



CREATE INDEX "productos_nombre_idx" ON "public"."productos" USING "btree" ("nombre");



CREATE INDEX "profiles_role_id_idx" ON "public"."profiles" USING "btree" ("role_id");



CREATE UNIQUE INDEX "sesiones_caja_una_abierta_por_usuario_idx" ON "public"."sesiones_caja" USING "btree" ("abierta_por") WHERE ("estado" = 'abierta'::"text");



CREATE OR REPLACE TRIGGER "categorias_set_updated_at" BEFORE UPDATE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "existencias_set_updated_at" BEFORE UPDATE ON "public"."existencias" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "productos_crear_existencia" AFTER INSERT ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."crear_existencia_producto"();



CREATE OR REPLACE TRIGGER "productos_set_updated_at" BEFORE UPDATE ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_colores_updated_at" BEFORE UPDATE ON "public"."colores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_devoluciones_compra_updated_at" BEFORE UPDATE ON "public"."devoluciones_compra" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_marcas_updated_at" BEFORE UPDATE ON "public"."marcas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_materiales_updated_at" BEFORE UPDATE ON "public"."materiales" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_modelos_updated_at" BEFORE UPDATE ON "public"."modelos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_recepciones_compra_updated_at" BEFORE UPDATE ON "public"."recepciones_compra" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_unidades_medida_updated_at" BEFORE UPDATE ON "public"."unidades_medida" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_actualizar_costos_recepcion" AFTER INSERT ON "public"."detalle_recepciones_compra" FOR EACH ROW EXECUTE FUNCTION "public"."actualizar_costos_recepcion"();



CREATE OR REPLACE TRIGGER "trg_clientes_web_updated_at" BEFORE UPDATE ON "public"."clientes_web" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_compras_updated_at" BEFORE UPDATE ON "public"."compras" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_pedidos_en_linea_updated_at" BEFORE UPDATE ON "public"."pedidos_en_linea" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_proveedores_updated_at" BEFORE UPDATE ON "public"."proveedores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validar_limite_credito" BEFORE INSERT OR UPDATE OF "saldo_pendiente" ON "public"."cuentas_por_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."validar_limite_credito"();



CREATE OR REPLACE TRIGGER "trg_ventas_updated_at" BEFORE UPDATE ON "public"."ventas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_vincular_movimiento_inventario" BEFORE INSERT ON "public"."movimientos_inventario" FOR EACH ROW EXECUTE FUNCTION "public"."vincular_movimiento_inventario"();



ALTER TABLE ONLY "public"."arqueos_caja"
    ADD CONSTRAINT "arqueos_caja_realizado_por_fkey" FOREIGN KEY ("realizado_por") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."arqueos_caja"
    ADD CONSTRAINT "arqueos_caja_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "public"."sesiones_caja"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."clientes_web"
    ADD CONSTRAINT "clientes_web_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_anulada_por_fkey" FOREIGN KEY ("anulada_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_autorizada_por_fkey" FOREIGN KEY ("autorizada_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compras"
    ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON UPDATE RESTRICT ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cotizaciones"
    ADD CONSTRAINT "cotizaciones_creada_por_fkey" FOREIGN KEY ("creada_por") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cuentas_por_cobrar"
    ADD CONSTRAINT "cuentas_por_cobrar_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_compras"
    ADD CONSTRAINT "detalle_compras_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_compras"
    ADD CONSTRAINT "detalle_compras_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON UPDATE RESTRICT ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_cotizaciones"
    ADD CONSTRAINT "detalle_cotizaciones_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_cotizaciones"
    ADD CONSTRAINT "detalle_cotizaciones_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_devoluciones_compra"
    ADD CONSTRAINT "detalle_devoluciones_compra_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "public"."devoluciones_compra"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_devoluciones_compra"
    ADD CONSTRAINT "detalle_devoluciones_compra_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_devoluciones_venta"
    ADD CONSTRAINT "detalle_devoluciones_venta_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "public"."devoluciones_venta"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_devoluciones_venta"
    ADD CONSTRAINT "detalle_devoluciones_venta_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_pedidos_en_linea"
    ADD CONSTRAINT "detalle_pedidos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos_en_linea"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_pedidos_en_linea"
    ADD CONSTRAINT "detalle_pedidos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_recepciones_compra"
    ADD CONSTRAINT "detalle_recepciones_compra_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_recepciones_compra"
    ADD CONSTRAINT "detalle_recepciones_compra_recepcion_id_fkey" FOREIGN KEY ("recepcion_id") REFERENCES "public"."recepciones_compra"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."detalle_ventas"
    ADD CONSTRAINT "detalle_ventas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."detalle_ventas"
    ADD CONSTRAINT "detalle_ventas_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devoluciones_compra"
    ADD CONSTRAINT "devoluciones_compra_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devoluciones_compra"
    ADD CONSTRAINT "devoluciones_compra_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_confirmada_por_fkey" FOREIGN KEY ("confirmada_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_creada_por_fkey" FOREIGN KEY ("creada_por") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_procesada_financieramente_por_fkey" FOREIGN KEY ("procesada_financieramente_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_reembolsada_por_fkey" FOREIGN KEY ("reembolsada_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."devoluciones_venta"
    ADD CONSTRAINT "devoluciones_venta_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."existencias"
    ADD CONSTRAINT "existencias_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_devolucion_venta_id_fkey" FOREIGN KEY ("devolucion_venta_id") REFERENCES "public"."devoluciones_venta"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_pago_venta_id_fkey" FOREIGN KEY ("pago_venta_id") REFERENCES "public"."pagos_venta"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "public"."sesiones_caja"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_caja"
    ADD CONSTRAINT "movimientos_caja_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_devolucion_compra_id_fkey" FOREIGN KEY ("devolucion_compra_id") REFERENCES "public"."devoluciones_compra"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_devolucion_venta_id_fkey" FOREIGN KEY ("devolucion_venta_id") REFERENCES "public"."devoluciones_venta"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_recepcion_compra_id_fkey" FOREIGN KEY ("recepcion_compra_id") REFERENCES "public"."recepciones_compra"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."movimientos_inventario"
    ADD CONSTRAINT "movimientos_inventario_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pagos_venta"
    ADD CONSTRAINT "pagos_venta_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pagos_venta"
    ADD CONSTRAINT "pagos_venta_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_cliente_web_id_fkey" FOREIGN KEY ("cliente_web_id") REFERENCES "public"."clientes_web"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_gestionado_por_fkey" FOREIGN KEY ("gestionado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedidos_en_linea"
    ADD CONSTRAINT "pedidos_en_linea_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "public"."colores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "public"."marcas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materiales"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "public"."modelos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_unidad_medida_id_fkey" FOREIGN KEY ("unidad_medida_id") REFERENCES "public"."unidades_medida"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."proveedor_productos"
    ADD CONSTRAINT "proveedor_productos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."proveedor_productos"
    ADD CONSTRAINT "proveedor_productos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."recepciones_compra"
    ADD CONSTRAINT "recepciones_compra_recibido_por_fkey" FOREIGN KEY ("recibido_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sesiones_caja"
    ADD CONSTRAINT "sesiones_caja_abierta_por_fkey" FOREIGN KEY ("abierta_por") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sesiones_caja"
    ADD CONSTRAINT "sesiones_caja_cerrada_por_fkey" FOREIGN KEY ("cerrada_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_anulada_por_fkey" FOREIGN KEY ("anulada_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "public"."cotizaciones"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_creada_por_fkey" FOREIGN KEY ("creada_por") REFERENCES "auth"."users"("id");



CREATE POLICY "Usuario puede consultar su propio perfil" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Usuarios autenticados pueden consultar roles activos" ON "public"."roles" FOR SELECT TO "authenticated" USING (("activo" = true));



ALTER TABLE "public"."arqueos_caja" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "arqueos_caja_select_caja" ON "public"."arqueos_caja" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."categorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categorias_insert_encargado_compras" ON "public"."categorias" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "categorias_select_operativos" ON "public"."categorias" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "categorias_update_encargado_compras" ON "public"."categorias" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_insert_ventas" ON "public"."clientes" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'vendedor'::"text"));



CREATE POLICY "clientes_select_ventas" ON "public"."clientes" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



CREATE POLICY "clientes_update_ventas" ON "public"."clientes" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'vendedor'::"text")) WITH CHECK (("public"."current_role_code"() = 'vendedor'::"text"));



ALTER TABLE "public"."clientes_web" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_web_select_own" ON "public"."clientes_web" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "clientes_web_update_own" ON "public"."clientes_web" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) AND ("activo" = true))) WITH CHECK ((("id" = "auth"."uid"()) AND ("activo" = true)));



ALTER TABLE "public"."colores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "colores_insert_encargado_compras" ON "public"."colores" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "colores_select_operativos" ON "public"."colores" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "colores_update_encargado_compras" ON "public"."colores" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."compras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compras_select_por_rol" ON "public"."compras" FOR SELECT TO "authenticated" USING ((("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])) OR (("public"."current_role_code"() = 'almacen'::"text") AND ("estado" = ANY (ARRAY['autorizada'::"text", 'recibida'::"text"])))));



ALTER TABLE "public"."cotizaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cotizaciones_insert_ventas" ON "public"."cotizaciones" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'vendedor'::"text"));



CREATE POLICY "cotizaciones_select_ventas" ON "public"."cotizaciones" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



CREATE POLICY "cotizaciones_update_ventas" ON "public"."cotizaciones" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'vendedor'::"text")) WITH CHECK (("public"."current_role_code"() = 'vendedor'::"text"));



ALTER TABLE "public"."cuentas_por_cobrar" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cuentas_por_cobrar_select_caja" ON "public"."cuentas_por_cobrar" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));



CREATE POLICY "cuentas_por_cobrar_select_ventas" ON "public"."cuentas_por_cobrar" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'responsable_caja'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."detalle_compras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_compras_select_por_rol" ON "public"."detalle_compras" FOR SELECT TO "authenticated" USING ((("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])) OR (("public"."current_role_code"() = 'almacen'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."compras" "c"
  WHERE (("c"."id" = "detalle_compras"."compra_id") AND ("c"."estado" = ANY (ARRAY['autorizada'::"text", 'recibida'::"text"]))))))));



ALTER TABLE "public"."detalle_cotizaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_cotizaciones_delete_ventas" ON "public"."detalle_cotizaciones" FOR DELETE TO "authenticated" USING ((("public"."current_role_code"() = 'vendedor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "detalle_cotizaciones"."cotizacion_id") AND ("c"."estado" = 'borrador'::"text"))))));



CREATE POLICY "detalle_cotizaciones_insert_ventas" ON "public"."detalle_cotizaciones" FOR INSERT TO "authenticated" WITH CHECK ((("public"."current_role_code"() = 'vendedor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "detalle_cotizaciones"."cotizacion_id") AND ("c"."estado" = 'borrador'::"text"))))));



CREATE POLICY "detalle_cotizaciones_select_ventas" ON "public"."detalle_cotizaciones" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



CREATE POLICY "detalle_cotizaciones_update_ventas" ON "public"."detalle_cotizaciones" FOR UPDATE TO "authenticated" USING ((("public"."current_role_code"() = 'vendedor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "detalle_cotizaciones"."cotizacion_id") AND ("c"."estado" = 'borrador'::"text")))))) WITH CHECK ((("public"."current_role_code"() = 'vendedor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."cotizaciones" "c"
  WHERE (("c"."id" = "detalle_cotizaciones"."cotizacion_id") AND ("c"."estado" = 'borrador'::"text"))))));



ALTER TABLE "public"."detalle_devoluciones_compra" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_devoluciones_compra_select_compras" ON "public"."detalle_devoluciones_compra" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'responsable_compras'::"text", 'almacen'::"text"])));



ALTER TABLE "public"."detalle_devoluciones_venta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_devoluciones_venta_select_comercial" ON "public"."detalle_devoluciones_venta" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."detalle_pedidos_en_linea" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_pedidos_en_linea_select_comercial" ON "public"."detalle_pedidos_en_linea" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."detalle_recepciones_compra" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_recepciones_compra_select_compras" ON "public"."detalle_recepciones_compra" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text", 'almacen'::"text"])));



ALTER TABLE "public"."detalle_ventas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "detalle_ventas_select" ON "public"."detalle_ventas" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."devoluciones_compra" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_compra_select_compras" ON "public"."devoluciones_compra" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'responsable_compras'::"text", 'almacen'::"text"])));



ALTER TABLE "public"."devoluciones_venta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_venta_select_caja" ON "public"."devoluciones_venta" FOR SELECT TO "authenticated" USING ((("public"."current_role_code"() = 'responsable_caja'::"text") AND ("estado" = 'confirmada'::"text")));



CREATE POLICY "devoluciones_venta_select_comercial" ON "public"."devoluciones_venta" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."existencias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "existencias_select_operativos" ON "public"."existencias" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



ALTER TABLE "public"."marcas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marcas_insert_encargado_compras" ON "public"."marcas" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "marcas_select_operativos" ON "public"."marcas" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "marcas_update_encargado_compras" ON "public"."marcas" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."materiales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materiales_insert_encargado_compras" ON "public"."materiales" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "materiales_select_operativos" ON "public"."materiales" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "materiales_update_encargado_compras" ON "public"."materiales" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."modelos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modelos_insert_encargado_compras" ON "public"."modelos" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "modelos_select_operativos" ON "public"."modelos" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "modelos_update_encargado_compras" ON "public"."modelos" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."movimientos_caja" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movimientos_caja_select" ON "public"."movimientos_caja" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['ventas'::"text", 'responsable_caja'::"text", 'gerencia'::"text"])));



CREATE POLICY "movimientos_caja_select_responsable" ON "public"."movimientos_caja" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."movimientos_inventario" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movimientos_select_operativos" ON "public"."movimientos_inventario" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



ALTER TABLE "public"."pagos_venta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pagos_venta_select" ON "public"."pagos_venta" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['ventas'::"text", 'responsable_caja'::"text", 'gerencia'::"text"])));



CREATE POLICY "pagos_venta_select_caja" ON "public"."pagos_venta" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."pedidos_en_linea" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedidos_en_linea_select_comercial" ON "public"."pedidos_en_linea" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_insert_encargado_compras" ON "public"."productos" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "productos_select_operativos" ON "public"."productos" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "productos_update_encargado_compras" ON "public"."productos" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedor_productos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proveedores_insert_encargado_compras" ON "public"."proveedores" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "proveedores_select_compras" ON "public"."proveedores" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "proveedores_update_encargado_compras" ON "public"."proveedores" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."recepciones_compra" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recepciones_compra_select_compras" ON "public"."recepciones_compra" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text", 'almacen'::"text"])));



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sesiones_caja" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sesiones_caja_select" ON "public"."sesiones_caja" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['ventas'::"text", 'responsable_caja'::"text", 'gerencia'::"text"])));



CREATE POLICY "sesiones_caja_select_caja" ON "public"."sesiones_caja" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));



ALTER TABLE "public"."unidades_medida" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "unidades_medida_insert_encargado_compras" ON "public"."unidades_medida" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



CREATE POLICY "unidades_medida_select_operativos" ON "public"."unidades_medida" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['gerencia'::"text", 'administracion'::"text", 'ventas'::"text", 'vendedor'::"text", 'responsable_comercial'::"text", 'marketing_digital'::"text", 'almacen'::"text", 'encargado_compras'::"text", 'responsable_compras'::"text"])));



CREATE POLICY "unidades_medida_update_encargado_compras" ON "public"."unidades_medida" FOR UPDATE TO "authenticated" USING (("public"."current_role_code"() = 'encargado_compras'::"text")) WITH CHECK (("public"."current_role_code"() = 'encargado_compras'::"text"));



ALTER TABLE "public"."ventas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_select" ON "public"."ventas" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['vendedor'::"text", 'responsable_comercial'::"text", 'gerencia'::"text"])));



CREATE POLICY "ventas_select_caja" ON "public"."ventas" FOR SELECT TO "authenticated" USING (("public"."current_role_code"() = ANY (ARRAY['responsable_caja'::"text", 'gerencia'::"text"])));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."abrir_caja"("p_monto_inicial" numeric, "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."abrir_caja"("p_monto_inicial" numeric, "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."alertas_recomendaciones_propietario"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alertas_recomendaciones_propietario"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."anular_compra"("p_compra_id" bigint, "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."anular_devolucion_venta"("p_devolucion_id" bigint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anular_devolucion_venta"("p_devolucion_id" bigint, "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" bigint, "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."aplicar_devolucion_financiera"("p_devolucion_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aplicar_devolucion_financiera"("p_devolucion_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."autorizar_compra"("p_compra_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."autorizar_compra"("p_compra_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cambiar_estado_pedido_web"("p_pedido_id" bigint, "p_estado" "text", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cambiar_estado_pedido_web"("p_pedido_id" bigint, "p_estado" "text", "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancelar_mi_pedido_web"("p_pedido_id" bigint, "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancelar_mi_pedido_web"("p_pedido_id" bigint, "p_motivo" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."catalogo_publico"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."catalogo_publico"() TO "anon";
GRANT ALL ON FUNCTION "public"."catalogo_publico"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cerrar_caja"("p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerrar_caja"("p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cobrar_venta"("p_venta_id" bigint, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cobrar_venta"("p_venta_id" bigint, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirmar_devolucion_venta"("p_devolucion_id" bigint, "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirmar_devolucion_venta"("p_devolucion_id" bigint, "p_items" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."convertir_pedido_web_en_venta"("p_pedido_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convertir_pedido_web_en_venta"("p_pedido_id" bigint) TO "authenticated";



GRANT ALL ON FUNCTION "public"."current_role_code"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."dashboard_propietario"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_propietario"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."detalle_mi_pedido_web"("p_pedido_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detalle_mi_pedido_web"("p_pedido_id" bigint) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mis_pedidos_web"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mis_pedidos_web"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reembolsar_devolucion_venta"("p_devolucion_id" bigint, "p_metodo_pago" "text", "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reembolsar_devolucion_venta"("p_devolucion_id" bigint, "p_metodo_pago" "text", "p_referencia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_abono_venta"("p_venta_id" bigint, "p_monto" numeric, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_abono_venta"("p_venta_id" bigint, "p_monto" numeric, "p_metodo_pago" "text", "p_monto_recibido" numeric, "p_referencia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_arqueo_caja"("p_efectivo_contado" numeric, "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_arqueo_caja"("p_efectivo_contado" numeric, "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_compra"("p_proveedor_id" bigint, "p_items" "jsonb", "p_tipo_compra" "text", "p_fecha_compra" "date", "p_referencia_documento" "text", "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_compra"("p_proveedor_id" bigint, "p_items" "jsonb", "p_tipo_compra" "text", "p_fecha_compra" "date", "p_referencia_documento" "text", "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_devolucion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_fecha_devolucion" "date", "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_devolucion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_fecha_devolucion" "date", "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_devolucion_venta"("p_venta_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_devolucion_venta"("p_venta_id" bigint, "p_items" "jsonb", "p_motivo" "text", "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_movimiento_caja"("p_tipo" "text", "p_concepto" "text", "p_metodo_pago" "text", "p_monto" numeric, "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_movimiento_caja"("p_tipo" "text", "p_concepto" "text", "p_metodo_pago" "text", "p_monto" numeric, "p_referencia" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."registrar_movimiento_inventario"("p_producto_id" bigint, "p_tipo" "text", "p_cantidad" numeric, "p_motivo" "text", "p_referencia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_pedido_web"("p_items" "jsonb", "p_modalidad_entrega" "text", "p_direccion_entrega" "text", "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_pedido_web"("p_items" "jsonb", "p_modalidad_entrega" "text", "p_direccion_entrega" "text", "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_recepcion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_fecha_recepcion" "date", "p_observaciones" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_recepcion_compra"("p_compra_id" bigint, "p_items" "jsonb", "p_fecha_recepcion" "date", "p_observaciones" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."registrar_venta"("p_items" "jsonb", "p_tipo_venta" "text", "p_cliente_id" bigint, "p_cliente_nombre" "text", "p_cotizacion_id" bigint, "p_fecha_vencimiento" "date", "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_venta"("p_items" "jsonb", "p_tipo_venta" "text", "p_cliente_id" bigint, "p_cliente_nombre" "text", "p_cotizacion_id" bigint, "p_fecha_vencimiento" "date", "p_referencia" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reportes_propietario"("p_desde" "date", "p_hasta" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reportes_propietario"("p_desde" "date", "p_hasta" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."tipo_cuenta_actual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tipo_cuenta_actual"() TO "authenticated";


















GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."arqueos_caja" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."arqueos_caja" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."arqueos_caja" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categorias" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."categorias" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categorias" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clientes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."clientes" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clientes" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."clientes_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clientes_web" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clientes_web" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."clientes_web" TO "service_role";



GRANT UPDATE("nombre") ON TABLE "public"."clientes_web" TO "authenticated";



GRANT UPDATE("telefono") ON TABLE "public"."clientes_web" TO "authenticated";



GRANT UPDATE("direccion") ON TABLE "public"."clientes_web" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."colores" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."colores" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."colores" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."compras" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."compras" TO "service_role";
GRANT SELECT ON TABLE "public"."compras" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cotizaciones" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."cotizaciones" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cotizaciones" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."cotizaciones_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cuentas_por_cobrar" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cuentas_por_cobrar" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cuentas_por_cobrar" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_compras" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_compras" TO "service_role";
GRANT SELECT ON TABLE "public"."detalle_compras" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_cotizaciones" TO "anon";
GRANT ALL ON TABLE "public"."detalle_cotizaciones" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_cotizaciones" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "public"."detalle_cotizaciones_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_compra" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_compra" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_compra" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_venta" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_venta" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_devoluciones_venta" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_pedidos_en_linea" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_pedidos_en_linea" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_pedidos_en_linea" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_recepciones_compra" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_recepciones_compra" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_recepciones_compra" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_ventas" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_ventas" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."detalle_ventas" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_compra" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_compra" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_compra" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_venta" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_venta" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."devoluciones_venta" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."existencias" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."existencias" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."existencias" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."marcas" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."marcas" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."marcas" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."materiales" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."materiales" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."materiales" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."modelos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."modelos" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."modelos" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_caja" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_caja" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_caja" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_inventario" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_inventario" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."movimientos_inventario" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pagos_venta" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pagos_venta" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pagos_venta" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pedidos_en_linea" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pedidos_en_linea" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pedidos_en_linea" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."productos" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."productos" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."productos" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "public"."proveedor_codigo_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."proveedor_productos" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."proveedor_productos" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."proveedor_productos" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."proveedores" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."proveedores" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."proveedores" TO "authenticated";



GRANT SELECT,USAGE ON SEQUENCE "public"."proveedores_id_seq" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recepciones_compra" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recepciones_compra" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."recepciones_compra" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "service_role";
GRANT SELECT ON TABLE "public"."roles" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sesiones_caja" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sesiones_caja" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sesiones_caja" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."unidades_medida" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."unidades_medida" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."unidades_medida" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ventas" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ventas" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."ventas" TO "service_role";



GRANT USAGE ON SEQUENCE "public"."ventas_numero_seq" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";





































-- =========================================================
-- COMPLEMENTOS NO INCLUIDOS POR pg_dump
-- =========================================================


-- ---------------------------------------------------------
-- AUTH · alta automática de perfil interno o cliente web
-- ---------------------------------------------------------

CREATE OR REPLACE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW
EXECUTE FUNCTION "public"."handle_new_user"();


-- ---------------------------------------------------------
-- CATÁLOGO DE ROLES
-- ---------------------------------------------------------

INSERT INTO "public"."roles" ("id", "codigo", "nombre", "descripcion", "activo", "created_at") VALUES
	(1, 'gerencia', 'Gerencia', 'Consulta indicadores, reportes, rendimiento, alertas y análisis para toma de decisiones.', true, '2026-09-21 02:37:50.865305+00'),
	(2, 'administracion', 'Administración', 'Gestiona y autoriza operaciones administrativas del negocio.', true, '2026-09-21 02:37:50.865305+00'),
	(3, 'ventas', 'Ventas y Caja', 'Registra ventas, consulta productos y realiza operaciones de caja autorizadas.', true, '2026-09-21 02:37:50.865305+00'),
	(5, 'soporte_ti', 'Soporte TI', 'Administra aspectos técnicos del sistema, usuarios, seguridad y configuraciones autorizadas.', true, '2026-09-21 02:37:50.865305+00'),
	(6, 'encargado_compras', 'Encargado de Compras', NULL, true, '2026-10-03 22:14:12.220636+00'),
	(7, 'responsable_compras', 'Responsable de Compras', NULL, true, '2026-10-03 22:14:12.220636+00'),
	(4, 'almacen', 'Bodeguero', 'Gestiona existencias, entradas, salidas, ajustes y necesidades de reposición.', true, '2026-09-21 02:37:50.865305+00'),
	(8, 'vendedor', 'Vendedor / Asesor de Ventas', 'Registra ventas, clientes, cotizaciones y operaciones comerciales autorizadas.', true, '2026-10-15 05:45:03.518553+00'),
	(9, 'responsable_comercial', 'Responsable Comercial y Atención al Cliente', 'Supervisa las operaciones del módulo de Ventas y gestiona situaciones comerciales especiales.', true, '2026-10-15 05:45:03.518553+00'),
	(10, 'marketing_digital', 'Responsable de Marketing y Canales Digitales', 'Gestiona las funciones comerciales relacionadas con el canal digital y los pedidos en línea.', true, '2026-10-15 05:45:03.518553+00'),
	(11, 'responsable_caja', 'Responsable de Caja y Facturación', 'Gestiona las operaciones del módulo de Caja, incluyendo apertura, cobros, movimientos, arqueo y cierre.', true, '2026-10-15 05:46:06.118074+00'),
	(12, 'propietario', 'Propietario', 'Consulta estratégica del negocio, dashboard, indicadores, reportes ejecutivos y alertas.', true, '2026-10-22 06:16:23.821531+00')
ON CONFLICT ("codigo") DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.roles', 'id'),
  (SELECT max("id") FROM "public"."roles")
);


-- ---------------------------------------------------------
-- STORAGE · imágenes de productos
-- ---------------------------------------------------------

-- Bucket público

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'productos',
  'productos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- Políticas

-- Storage exige SELECT para poder eliminar archivos; por eso
-- se concede solo al encargado y no al público.
DROP POLICY IF EXISTS productos_imagenes_select_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_select_encargado_compras
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);


DROP POLICY IF EXISTS productos_imagenes_insert_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_insert_encargado_compras
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);


DROP POLICY IF EXISTS productos_imagenes_delete_encargado_compras
ON storage.objects;

CREATE POLICY productos_imagenes_delete_encargado_compras
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'productos'
  AND public.current_role_code() = 'encargado_compras'
);



-- ---------------------------------------------------------
-- PRIVILEGIOS EXACTOS DE LA BASE REMOTA
--
-- Un proyecto Supabase nuevo concede por defecto todo a anon,
-- authenticated y service_role al crear objetos. La base remota
-- es más restrictiva (mínimo privilegio) y pg_dump no lo refleja,
-- así que se igualan aquí. Generado con supabase db diff --linked.
-- ---------------------------------------------------------


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "service_role";

REVOKE ALL ON FUNCTION "public"."abrir_caja"(numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."abrir_caja"(numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."actualizar_costos_recepcion"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."actualizar_costos_recepcion"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."actualizar_costos_recepcion"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."alertas_recomendaciones_propietario"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."alertas_recomendaciones_propietario"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."anular_compra"(bigint, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."anular_compra"(bigint, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."anular_devolucion_venta"(bigint, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."anular_devolucion_venta"(bigint, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."anular_venta"(bigint, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."anular_venta"(bigint, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."aplicar_devolucion_financiera"(bigint) FROM "anon";

REVOKE ALL ON FUNCTION "public"."aplicar_devolucion_financiera"(bigint) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."autorizar_compra"(bigint) FROM "anon";

REVOKE ALL ON FUNCTION "public"."autorizar_compra"(bigint) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."cambiar_estado_pedido_web"(bigint, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."cambiar_estado_pedido_web"(bigint, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."cancelar_mi_pedido_web"(bigint, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."cancelar_mi_pedido_web"(bigint, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."catalogo_publico"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."cerrar_caja"(text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."cerrar_caja"(text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."cobrar_venta"(bigint, text, numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."cobrar_venta"(bigint, text, numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."confirmar_devolucion_venta"(bigint, jsonb) FROM "anon";

REVOKE ALL ON FUNCTION "public"."confirmar_devolucion_venta"(bigint, jsonb) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."convertir_pedido_web_en_venta"(bigint) FROM "anon";

REVOKE ALL ON FUNCTION "public"."convertir_pedido_web_en_venta"(bigint) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."crear_existencia_producto"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."crear_existencia_producto"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."crear_existencia_producto"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."current_role_code"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."current_role_code"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."dashboard_propietario"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."dashboard_propietario"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."detalle_mi_pedido_web"(bigint) FROM "anon";

REVOKE ALL ON FUNCTION "public"."detalle_mi_pedido_web"(bigint) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."mis_pedidos_web"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."mis_pedidos_web"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."reembolsar_devolucion_venta"(bigint, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."reembolsar_devolucion_venta"(bigint, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_abono_venta"(bigint, numeric, text, numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_abono_venta"(bigint, numeric, text, numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_arqueo_caja"(numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_arqueo_caja"(numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_compra"(bigint, jsonb, text, date, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_compra"(bigint, jsonb, text, date, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_devolucion_compra"(bigint, jsonb, text, date, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_devolucion_compra"(bigint, jsonb, text, date, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_devolucion_venta"(bigint, jsonb, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_devolucion_venta"(bigint, jsonb, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_movimiento_caja"(text, text, text, numeric, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_movimiento_caja"(text, text, text, numeric, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_movimiento_inventario"(bigint, text, numeric, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_movimiento_inventario"(bigint, text, numeric, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_pedido_web"(jsonb, text, text, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_pedido_web"(jsonb, text, text, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_recepcion_compra"(bigint, jsonb, date, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_recepcion_compra"(bigint, jsonb, date, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."registrar_venta"(jsonb, text, bigint, text, bigint, date, text) FROM "anon";

REVOKE ALL ON FUNCTION "public"."registrar_venta"(jsonb, text, bigint, text, bigint, date, text) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."reportes_propietario"(date, date) FROM "anon";

REVOKE ALL ON FUNCTION "public"."reportes_propietario"(date, date) FROM "service_role";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."tipo_cuenta_actual"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."tipo_cuenta_actual"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."validar_limite_credito"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."validar_limite_credito"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."validar_limite_credito"() FROM "service_role";

REVOKE ALL ON FUNCTION "public"."vincular_movimiento_inventario"() FROM "anon";

REVOKE ALL ON FUNCTION "public"."vincular_movimiento_inventario"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."vincular_movimiento_inventario"() FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."arqueos_caja_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."arqueos_caja_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."arqueos_caja_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."categorias_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."categorias_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."categorias_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."clientes_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."clientes_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."colores_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."colores_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."colores_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."compra_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."compra_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."compra_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."compras_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."compras_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."compras_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."cotizaciones_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."cotizaciones_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."cuentas_por_cobrar_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."cuentas_por_cobrar_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."cuentas_por_cobrar_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_compras_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_compras_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_compras_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_cotizaciones_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_cotizaciones_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_compra_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_compra_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_compra_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_venta_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_venta_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_devoluciones_venta_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_pedidos_en_linea_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_pedidos_en_linea_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_pedidos_en_linea_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_recepciones_compra_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_recepciones_compra_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_recepciones_compra_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."detalle_ventas_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."detalle_ventas_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_ventas_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."devolucion_compra_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."devolucion_compra_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."devolucion_compra_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."devolucion_venta_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."devolucion_venta_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."devolucion_venta_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."devoluciones_compra_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."devoluciones_compra_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."devoluciones_compra_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."devoluciones_venta_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."devoluciones_venta_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."devoluciones_venta_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."marcas_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."marcas_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."marcas_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."materiales_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."materiales_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."materiales_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."modelos_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."modelos_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."modelos_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."movimientos_caja_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."movimientos_caja_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."movimientos_caja_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."movimientos_inventario_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."movimientos_inventario_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."movimientos_inventario_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."pagos_venta_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."pagos_venta_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."pagos_venta_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."pedido_web_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."pedido_web_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."pedido_web_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."pedidos_en_linea_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."pedidos_en_linea_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."pedidos_en_linea_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."productos_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."productos_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."productos_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."proveedor_codigo_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."proveedor_codigo_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."proveedor_productos_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."proveedor_productos_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."proveedor_productos_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."proveedores_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."proveedores_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."recepcion_compra_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."recepcion_compra_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."recepcion_compra_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."recepciones_compra_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."recepciones_compra_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."recepciones_compra_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."roles_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."roles_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."roles_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."sesion_caja_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."sesion_caja_numero_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."sesion_caja_numero_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."sesiones_caja_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."sesiones_caja_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."sesiones_caja_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."unidades_medida_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."unidades_medida_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."unidades_medida_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."ventas_id_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."ventas_id_seq" FROM "authenticated";

REVOKE ALL ON SEQUENCE "public"."ventas_id_seq" FROM "service_role";

REVOKE ALL ON SEQUENCE "public"."ventas_numero_seq" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."ventas_numero_seq" FROM "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

REVOKE ALL ON TABLE "public"."roles" FROM "anon";

REVOKE ALL ON SEQUENCE "public"."clientes_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."clientes_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."cotizaciones_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."cotizaciones_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."detalle_cotizaciones_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."detalle_cotizaciones_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."proveedor_codigo_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."proveedor_codigo_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."proveedores_id_seq" FROM "authenticated";

GRANT SELECT, USAGE ON SEQUENCE "public"."proveedores_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."ventas_numero_seq" FROM "authenticated";

GRANT USAGE ON SEQUENCE "public"."ventas_numero_seq" TO "authenticated";

REVOKE ALL ON TABLE "public"."arqueos_caja" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."arqueos_caja" TO "anon";

REVOKE ALL ON TABLE "public"."arqueos_caja" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."arqueos_caja" TO "authenticated";

REVOKE ALL ON TABLE "public"."arqueos_caja" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."arqueos_caja" TO "service_role";

REVOKE ALL ON TABLE "public"."categorias" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."categorias" TO "anon";

REVOKE ALL ON TABLE "public"."categorias" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categorias" TO "authenticated";

REVOKE ALL ON TABLE "public"."categorias" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."categorias" TO "service_role";

REVOKE ALL ON TABLE "public"."clientes" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."clientes" TO "anon";

REVOKE ALL ON TABLE "public"."clientes" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clientes" TO "authenticated";

REVOKE ALL ON TABLE "public"."clientes" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."clientes" TO "service_role";

REVOKE ALL ON TABLE "public"."clientes_web" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."clientes_web" TO "anon";

REVOKE ALL ON TABLE "public"."clientes_web" FROM "authenticated";

REVOKE ALL ("direccion") ON TABLE "public"."clientes_web" FROM "authenticated";

GRANT UPDATE ("direccion") ON TABLE "public"."clientes_web" TO "authenticated";

REVOKE ALL ("nombre") ON TABLE "public"."clientes_web" FROM "authenticated";

GRANT UPDATE ("nombre") ON TABLE "public"."clientes_web" TO "authenticated";

REVOKE ALL ("telefono") ON TABLE "public"."clientes_web" FROM "authenticated";

GRANT UPDATE ("telefono") ON TABLE "public"."clientes_web" TO "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."clientes_web" TO "authenticated";

REVOKE ALL ON TABLE "public"."clientes_web" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."clientes_web" TO "service_role";

REVOKE ALL ON TABLE "public"."colores" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."colores" TO "anon";

REVOKE ALL ON TABLE "public"."colores" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."colores" TO "authenticated";

REVOKE ALL ON TABLE "public"."colores" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."colores" TO "service_role";

REVOKE ALL ON TABLE "public"."compras" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."compras" TO "anon";

REVOKE ALL ON TABLE "public"."compras" FROM "authenticated";

GRANT SELECT ON TABLE "public"."compras" TO "authenticated";

REVOKE ALL ON TABLE "public"."compras" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."compras" TO "service_role";

REVOKE ALL ON TABLE "public"."cotizaciones" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."cotizaciones" TO "anon";

REVOKE ALL ON TABLE "public"."cotizaciones" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cotizaciones" TO "authenticated";

REVOKE ALL ON TABLE "public"."cotizaciones" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."cotizaciones" TO "service_role";

REVOKE ALL ON TABLE "public"."cuentas_por_cobrar" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."cuentas_por_cobrar" TO "anon";

REVOKE ALL ON TABLE "public"."cuentas_por_cobrar" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."cuentas_por_cobrar" TO "authenticated";

REVOKE ALL ON TABLE "public"."cuentas_por_cobrar" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."cuentas_por_cobrar" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_compras" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_compras" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_compras" FROM "authenticated";

GRANT SELECT ON TABLE "public"."detalle_compras" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_compras" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_compras" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_cotizaciones" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_cotizaciones" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_cotizaciones" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_cotizaciones" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_compra" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_compra" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_compra" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_compra" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_compra" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_compra" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_venta" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_venta" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_venta" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_venta" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_devoluciones_venta" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_devoluciones_venta" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_pedidos_en_linea" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_pedidos_en_linea" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_pedidos_en_linea" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."detalle_pedidos_en_linea" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_pedidos_en_linea" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_pedidos_en_linea" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_recepciones_compra" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_recepciones_compra" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_recepciones_compra" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."detalle_recepciones_compra" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_recepciones_compra" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_recepciones_compra" TO "service_role";

REVOKE ALL ON TABLE "public"."detalle_ventas" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_ventas" TO "anon";

REVOKE ALL ON TABLE "public"."detalle_ventas" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."detalle_ventas" TO "authenticated";

REVOKE ALL ON TABLE "public"."detalle_ventas" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."detalle_ventas" TO "service_role";

REVOKE ALL ON TABLE "public"."devoluciones_compra" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_compra" TO "anon";

REVOKE ALL ON TABLE "public"."devoluciones_compra" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_compra" TO "authenticated";

REVOKE ALL ON TABLE "public"."devoluciones_compra" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_compra" TO "service_role";

REVOKE ALL ON TABLE "public"."devoluciones_venta" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_venta" TO "anon";

REVOKE ALL ON TABLE "public"."devoluciones_venta" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_venta" TO "authenticated";

REVOKE ALL ON TABLE "public"."devoluciones_venta" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."devoluciones_venta" TO "service_role";

REVOKE ALL ON TABLE "public"."existencias" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."existencias" TO "anon";

REVOKE ALL ON TABLE "public"."existencias" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."existencias" TO "authenticated";

REVOKE ALL ON TABLE "public"."existencias" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."existencias" TO "service_role";

REVOKE ALL ON TABLE "public"."marcas" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."marcas" TO "anon";

REVOKE ALL ON TABLE "public"."marcas" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."marcas" TO "authenticated";

REVOKE ALL ON TABLE "public"."marcas" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."marcas" TO "service_role";

REVOKE ALL ON TABLE "public"."materiales" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."materiales" TO "anon";

REVOKE ALL ON TABLE "public"."materiales" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."materiales" TO "authenticated";

REVOKE ALL ON TABLE "public"."materiales" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."materiales" TO "service_role";

REVOKE ALL ON TABLE "public"."modelos" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."modelos" TO "anon";

REVOKE ALL ON TABLE "public"."modelos" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."modelos" TO "authenticated";

REVOKE ALL ON TABLE "public"."modelos" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."modelos" TO "service_role";

REVOKE ALL ON TABLE "public"."movimientos_caja" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_caja" TO "anon";

REVOKE ALL ON TABLE "public"."movimientos_caja" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_caja" TO "authenticated";

REVOKE ALL ON TABLE "public"."movimientos_caja" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_caja" TO "service_role";

REVOKE ALL ON TABLE "public"."movimientos_inventario" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_inventario" TO "anon";

REVOKE ALL ON TABLE "public"."movimientos_inventario" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_inventario" TO "authenticated";

REVOKE ALL ON TABLE "public"."movimientos_inventario" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."movimientos_inventario" TO "service_role";

REVOKE ALL ON TABLE "public"."pagos_venta" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."pagos_venta" TO "anon";

REVOKE ALL ON TABLE "public"."pagos_venta" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."pagos_venta" TO "authenticated";

REVOKE ALL ON TABLE "public"."pagos_venta" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."pagos_venta" TO "service_role";

REVOKE ALL ON TABLE "public"."pedidos_en_linea" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."pedidos_en_linea" TO "anon";

REVOKE ALL ON TABLE "public"."pedidos_en_linea" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."pedidos_en_linea" TO "authenticated";

REVOKE ALL ON TABLE "public"."pedidos_en_linea" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."pedidos_en_linea" TO "service_role";

REVOKE ALL ON TABLE "public"."productos" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."productos" TO "anon";

REVOKE ALL ON TABLE "public"."productos" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."productos" TO "authenticated";

REVOKE ALL ON TABLE "public"."productos" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."productos" TO "service_role";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."proveedor_productos" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."proveedor_productos" TO "anon";

REVOKE ALL ON TABLE "public"."proveedor_productos" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."proveedor_productos" TO "authenticated";

REVOKE ALL ON TABLE "public"."proveedor_productos" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."proveedor_productos" TO "service_role";

REVOKE ALL ON TABLE "public"."proveedores" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."proveedores" TO "anon";

REVOKE ALL ON TABLE "public"."proveedores" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."proveedores" TO "authenticated";

REVOKE ALL ON TABLE "public"."proveedores" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."proveedores" TO "service_role";

REVOKE ALL ON TABLE "public"."recepciones_compra" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."recepciones_compra" TO "anon";

REVOKE ALL ON TABLE "public"."recepciones_compra" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."recepciones_compra" TO "authenticated";

REVOKE ALL ON TABLE "public"."recepciones_compra" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."recepciones_compra" TO "service_role";

REVOKE ALL ON TABLE "public"."roles" FROM "authenticated";

GRANT SELECT ON TABLE "public"."roles" TO "authenticated";

REVOKE ALL ON TABLE "public"."roles" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."roles" TO "service_role";

REVOKE ALL ON TABLE "public"."sesiones_caja" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sesiones_caja" TO "anon";

REVOKE ALL ON TABLE "public"."sesiones_caja" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."sesiones_caja" TO "authenticated";

REVOKE ALL ON TABLE "public"."sesiones_caja" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."sesiones_caja" TO "service_role";

REVOKE ALL ON TABLE "public"."unidades_medida" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."unidades_medida" TO "anon";

REVOKE ALL ON TABLE "public"."unidades_medida" FROM "authenticated";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."unidades_medida" TO "authenticated";

REVOKE ALL ON TABLE "public"."unidades_medida" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."unidades_medida" TO "service_role";

REVOKE ALL ON TABLE "public"."ventas" FROM "anon";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."ventas" TO "anon";

REVOKE ALL ON TABLE "public"."ventas" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."ventas" TO "authenticated";

REVOKE ALL ON TABLE "public"."ventas" FROM "service_role";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."ventas" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "service_role";
