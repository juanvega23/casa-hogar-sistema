-- =========================================================
-- PRECIO DE VENTA Y DESCUENTO: RESPONSABLE COMERCIAL
--
-- Hasta ahora solo Compras podía editar productos, así que el
-- mismo rol que compra fijaba el precio de venta y el descuento.
-- Desde aquí:
--   · encargado_compras crea y edita el producto (datos, costo,
--     mínimos, imagen) y pone el precio inicial al crearlo;
--   · responsable_comercial cambia precio de venta y descuento
--     con actualizar_precio_producto(), que no deja vender por
--     debajo del costo y registra cada cambio en historial_precios.
--
-- La fórmula del precio final es la misma de registrar_venta(),
-- registrar_pedido_web() y catalogo_publico():
--   round(precio_venta × (1 − descuento / 100), 2)
--
-- Afecta:
--   historial_precios                 (tabla nueva, RLS sin políticas)
--   actualizar_precio_producto(...)   (función nueva)
--   productos                         (UPDATE e INSERT por columna para
--                                      authenticated: sin precio_venta
--                                      ni descuento en UPDATE; sin
--                                      descuento en INSERT)
--   auditoria_sistema(...)            (muestra los cambios de precio)
-- Políticas RLS de productos: sin cambios.
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. HISTORIAL DE PRECIOS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.historial_precios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  producto_id bigint NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  precio_venta_anterior numeric(14,2) NOT NULL,
  precio_venta_nuevo numeric(14,2) NOT NULL,
  descuento_anterior numeric(5,2) NOT NULL,
  descuento_nuevo numeric(5,2) NOT NULL,
  motivo text,
  cambiado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historial_precios_producto
ON public.historial_precios (producto_id, created_at DESC);

-- Sin políticas: se escribe y se consulta solo desde funciones.
ALTER TABLE public.historial_precios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.historial_precios FROM anon, authenticated;


-- ---------------------------------------------------------
-- 2. CAMBIO DE PRECIO Y DESCUENTO
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_precio_producto(
  p_producto_id bigint,
  p_precio_venta numeric,
  p_descuento_porcentaje numeric DEFAULT 0,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE (
  producto_id bigint,
  precio_venta numeric,
  descuento_porcentaje numeric,
  precio_final numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid := auth.uid();
  v_producto record;
  v_precio numeric(14,2);
  v_descuento numeric(5,2);
  v_final numeric(14,2);
  v_motivo text := NULLIF(TRIM(COALESCE(p_motivo, '')), '');
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_comercial' THEN
    RAISE EXCEPTION 'Solo el Responsable Comercial puede cambiar precios y descuentos.';
  END IF;

  IF p_precio_venta IS NULL OR p_precio_venta <= 0 THEN
    RAISE EXCEPTION 'El precio de venta debe ser mayor que cero.';
  END IF;

  v_descuento := round(COALESCE(p_descuento_porcentaje, 0), 2);

  IF v_descuento < 0 OR v_descuento >= 100 THEN
    RAISE EXCEPTION 'El descuento debe estar entre 0 y 99 por ciento.';
  END IF;

  v_precio := round(p_precio_venta, 2);

  SELECT
    p.id,
    p.nombre,
    p.precio_compra,
    p.precio_venta,
    p.descuento_porcentaje
  INTO v_producto
  FROM public.productos p
  WHERE p.id = p_producto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto indicado no existe.';
  END IF;

  v_final := round(v_precio * (1 - v_descuento / 100), 2);

  IF v_final < COALESCE(v_producto.precio_compra, 0) THEN
    RAISE EXCEPTION
      'El precio final de % (C$%) queda por debajo de su costo (C$%). Sube el precio o baja el descuento.',
      v_producto.nombre,
      trim(to_char(v_final, 'FM999999990.00')),
      trim(to_char(v_producto.precio_compra, 'FM999999990.00'));
  END IF;

  IF v_precio = v_producto.precio_venta
     AND v_descuento = v_producto.descuento_porcentaje THEN
    RAISE EXCEPTION 'El precio y el descuento no cambiaron.';
  END IF;

  UPDATE public.productos
  SET
    precio_venta = v_precio,
    descuento_porcentaje = v_descuento
  WHERE id = p_producto_id;

  INSERT INTO public.historial_precios (
    producto_id,
    precio_venta_anterior,
    precio_venta_nuevo,
    descuento_anterior,
    descuento_nuevo,
    motivo,
    cambiado_por
  )
  VALUES (
    p_producto_id,
    v_producto.precio_venta,
    v_precio,
    v_producto.descuento_porcentaje,
    v_descuento,
    v_motivo,
    v_usuario
  );

  RETURN QUERY
  SELECT p_producto_id, v_precio::numeric, v_descuento::numeric, v_final::numeric;
END;
$$;

ALTER FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_precio_producto(bigint, numeric, numeric, text) TO authenticated;


-- ---------------------------------------------------------
-- 3. PRIVILEGIOS POR COLUMNA EN PRODUCTOS
-- La política productos_update_encargado_compras sigue igual;
-- esto solo quita las columnas de precio y descuento.
-- ---------------------------------------------------------

REVOKE UPDATE, INSERT ON TABLE public.productos FROM authenticated;

GRANT UPDATE (
  codigo, codigo_barras, nombre, descripcion, categoria_id,
  unidad_medida, unidad_medida_id, marca_id, modelo_id, color_id,
  material_id, precio_compra, stock_minimo, stock_maximo, activo,
  imagen_url
) ON TABLE public.productos TO authenticated;

GRANT INSERT (
  codigo, codigo_barras, nombre, descripcion, categoria_id,
  unidad_medida, unidad_medida_id, marca_id, modelo_id, color_id,
  material_id, precio_compra, precio_venta, stock_minimo, stock_maximo,
  activo, imagen_url
) ON TABLE public.productos TO authenticated;


-- ---------------------------------------------------------
-- 4. AUDITORÍA: CAMBIOS DE PRECIO
-- Igual que la versión vigente, con una rama más.
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
        COALESCE(' · ' || h.motivo, ''),
      h.cambiado_por
    FROM public.historial_precios h
    JOIN public.productos pr
      ON pr.id = h.producto_id
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
$function$;

COMMIT;
