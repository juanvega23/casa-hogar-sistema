-- =========================================================
-- 023 · RECEPCIÓN DE COMPRAS · COSTOS Y TRAZABILIDAD
--
-- 1. Al recibir una compra, el costo pagado pasa a ser el
--    costo actual del producto (productos.precio_compra) y el
--    último costo del proveedor (proveedor_productos).
--    Así la ganancia bruta del propietario y el "mejor costo"
--    de las alertas usan datos reales.
--
-- 2. Los movimientos de inventario generados por recepciones
--    (RC-xxxxxx) y devoluciones de compra (DC-xxxxxx) quedan
--    vinculados por FK a su documento de origen.
--
-- Se implementa con triggers para NO reescribir las funciones
-- registrar_recepcion_compra() y registrar_devolucion_compra(),
-- que ya funcionan.
-- =========================================================

BEGIN;


-- =========================================================
-- 1. ACTUALIZAR COSTOS AL RECIBIR
-- =========================================================

CREATE OR REPLACE FUNCTION public.actualizar_costos_recepcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

ALTER FUNCTION public.actualizar_costos_recepcion() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_actualizar_costos_recepcion
ON public.detalle_recepciones_compra;

CREATE TRIGGER trg_actualizar_costos_recepcion
AFTER INSERT ON public.detalle_recepciones_compra
FOR EACH ROW
EXECUTE FUNCTION public.actualizar_costos_recepcion();


-- Poblar proveedor_productos con las recepciones ya registradas
-- (se toma la recepción más reciente de cada proveedor/producto).
INSERT INTO public.proveedor_productos (
  proveedor_id,
  producto_id,
  ultimo_costo,
  activo
)
SELECT DISTINCT ON (c.proveedor_id, dc.producto_id)
  c.proveedor_id,
  dc.producto_id,
  dc.costo_unitario,
  true
FROM public.detalle_recepciones_compra drc
JOIN public.recepciones_compra rc
  ON rc.id = drc.recepcion_id
JOIN public.compras c
  ON c.id = rc.compra_id
JOIN public.detalle_compras dc
  ON dc.compra_id = c.id
 AND dc.producto_id = drc.producto_id
ORDER BY
  c.proveedor_id,
  dc.producto_id,
  rc.created_at DESC
ON CONFLICT (proveedor_id, producto_id) DO NOTHING;


-- =========================================================
-- 2. VINCULAR MOVIMIENTOS CON SU DOCUMENTO DE ORIGEN
-- =========================================================

CREATE OR REPLACE FUNCTION public.vincular_movimiento_inventario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

ALTER FUNCTION public.vincular_movimiento_inventario() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_vincular_movimiento_inventario
ON public.movimientos_inventario;

CREATE TRIGGER trg_vincular_movimiento_inventario
BEFORE INSERT ON public.movimientos_inventario
FOR EACH ROW
EXECUTE FUNCTION public.vincular_movimiento_inventario();


-- Completar los movimientos históricos.
UPDATE public.movimientos_inventario m
SET recepcion_compra_id = rc.id
FROM public.recepciones_compra rc
WHERE m.recepcion_compra_id IS NULL
  AND m.referencia = rc.numero;

UPDATE public.movimientos_inventario m
SET devolucion_compra_id = dc.id
FROM public.devoluciones_compra dc
WHERE m.devolucion_compra_id IS NULL
  AND m.referencia = dc.numero;

COMMIT;
