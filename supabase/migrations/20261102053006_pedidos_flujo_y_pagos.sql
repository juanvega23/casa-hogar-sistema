-- =========================================================
-- PEDIDOS EN LÍNEA: FLUJO CON VALIDACIÓN, PAGOS Y DIRECCIONES
-- (correcciones del profesor)
--
-- Flujo nuevo del pedido:
--   pendiente_validacion → validado → en_despacho → entregado
--   (+ rechazado / cancelado)
--
--   - Transferencia: el cliente elige banco y cuenta (guardadas en
--     la base, no fijas en el código) y sube el comprobante; el
--     Responsable de Caja lo aprueba o rechaza.
--   - Tarjeta: pasarela SIMULADA (demostración). Se valida el número
--     (Luhn), la marca y el vencimiento; nunca se guarda el número
--     completo, solo marca, últimos 4 y código de autorización.
--     Tarjetas de prueba: 4000 0000 0000 0002 (rechazada) y
--     4000 0000 0000 9995 (fondos insuficientes); el resto se aprueba.
--   - Efectivo (al retirar o al recibir): el Vendedor valida el
--     pedido (existencias y datos de entrega).
--   - Pasar a despacho (Vendedor) crea la venta y RECIÉN AHÍ se
--     descuenta el inventario. Se respeta el precio con que se hizo
--     el pedido. Si ya estaba pagado, la venta queda pagada.
--   - Bodega marca la entrega (o el retiro).
--   - Si se cancela un pedido ya pagado, el pago queda "por
--     reembolsar" y Caja registra el reembolso.
--
-- Además: libreta de direcciones del cliente, cuentas bancarias y
-- tipo de cambio administrados por Caja, y bucket privado de
-- comprobantes.
--
-- Afecta:
--   pedidos_en_linea  (estados nuevos, metodo_pago obligatorio,
--                      columnas de despacho y entrega; Bodega puede
--                      consultarlos)
--   cuentas_bancarias, parametros_negocio, direcciones_cliente,
--   pagos_pedido_web                                (tablas nuevas)
--   storage: bucket "comprobantes" + políticas
--   registrar_pedido_web, cambiar_estado_pedido_web,
--   convertir_pedido_web_en_venta, cancelar_mi_pedido_web,
--   mis_pedidos_web, dashboard_propietario,
--   alertas_supervision_gerencia                    (redefinidas)
--   registrar_comprobante_pedido_web, pagar_pedido_web_tarjeta,
--   revisar_pago_pedido_web, reembolsar_pago_pedido_web,
--   pagos_en_linea_caja, actualizar_tipo_cambio,
--   luhn_valido                                     (nuevas)
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. ESTADOS DEL PEDIDO
-- ---------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.pedidos_en_linea'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE public.pedidos_en_linea DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.pedidos_en_linea
  ADD COLUMN IF NOT EXISTS despachado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS despachado_at timestamptz,
  ADD COLUMN IF NOT EXISTS entregado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entregado_at timestamptz;

-- Estados anteriores → nuevos
UPDATE public.pedidos_en_linea p
SET estado = CASE p.estado
  WHEN 'recibido' THEN 'pendiente_validacion'
  WHEN 'confirmado' THEN 'validado'
  WHEN 'preparado' THEN 'validado'
  WHEN 'convertido' THEN
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.ventas v
        WHERE v.id = p.venta_id AND v.estado IN ('pagada', 'completada')
      ) THEN 'entregado'
      ELSE 'en_despacho'
    END
  ELSE p.estado
END
WHERE p.estado IN ('recibido', 'confirmado', 'preparado', 'convertido');

-- Los pedidos sin forma de pago (anteriores a esa opción) se pagan en efectivo
UPDATE public.pedidos_en_linea SET metodo_pago = 'efectivo' WHERE metodo_pago IS NULL;

ALTER TABLE public.pedidos_en_linea ALTER COLUMN metodo_pago SET DEFAULT 'efectivo';
ALTER TABLE public.pedidos_en_linea ALTER COLUMN metodo_pago SET NOT NULL;
ALTER TABLE public.pedidos_en_linea ALTER COLUMN estado SET DEFAULT 'pendiente_validacion';

ALTER TABLE public.pedidos_en_linea
  ADD CONSTRAINT pedidos_en_linea_estado_check
  CHECK (estado IN ('pendiente_validacion', 'validado', 'en_despacho', 'entregado', 'rechazado', 'cancelado'));

-- Bodega consulta los pedidos para despacharlos
DROP POLICY IF EXISTS pedidos_en_linea_select_comercial ON public.pedidos_en_linea;
CREATE POLICY pedidos_en_linea_select_comercial ON public.pedidos_en_linea
  FOR SELECT TO authenticated
  USING (public.current_role_code() = ANY (ARRAY['vendedor', 'responsable_comercial', 'gerencia', 'almacen']));

DROP POLICY IF EXISTS detalle_pedidos_en_linea_select_comercial ON public.detalle_pedidos_en_linea;
CREATE POLICY detalle_pedidos_en_linea_select_comercial ON public.detalle_pedidos_en_linea
  FOR SELECT TO authenticated
  USING (public.current_role_code() = ANY (ARRAY['vendedor', 'responsable_comercial', 'gerencia', 'almacen']));


-- ---------------------------------------------------------
-- 2. CUENTAS BANCARIAS Y TIPO DE CAMBIO (administra Caja)
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cuentas_bancarias (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  banco text NOT NULL,
  titular text NOT NULL,
  numero text NOT NULL,
  moneda text NOT NULL,
  tipo_cuenta text NOT NULL DEFAULT 'Corriente',
  activa boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cuentas_bancarias_moneda_check CHECK (moneda IN ('NIO', 'USD')),
  CONSTRAINT cuentas_bancarias_banco_check CHECK (length(btrim(banco)) >= 2),
  CONSTRAINT cuentas_bancarias_numero_check CHECK (length(btrim(numero)) >= 4),
  CONSTRAINT cuentas_bancarias_unica UNIQUE (banco, numero)
);

ALTER TABLE public.cuentas_bancarias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cuentas_bancarias FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cuentas_bancarias TO authenticated;
GRANT INSERT (banco, titular, numero, moneda, tipo_cuenta, activa, orden) ON TABLE public.cuentas_bancarias TO authenticated;
GRANT UPDATE (banco, titular, numero, moneda, tipo_cuenta, activa, orden, updated_at) ON TABLE public.cuentas_bancarias TO authenticated;

DROP POLICY IF EXISTS cuentas_bancarias_select ON public.cuentas_bancarias;
CREATE POLICY cuentas_bancarias_select ON public.cuentas_bancarias
  FOR SELECT TO authenticated
  USING (activa OR public.current_role_code() = 'responsable_caja');

DROP POLICY IF EXISTS cuentas_bancarias_insert_caja ON public.cuentas_bancarias;
CREATE POLICY cuentas_bancarias_insert_caja ON public.cuentas_bancarias
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role_code() = 'responsable_caja');

DROP POLICY IF EXISTS cuentas_bancarias_update_caja ON public.cuentas_bancarias;
CREATE POLICY cuentas_bancarias_update_caja ON public.cuentas_bancarias
  FOR UPDATE TO authenticated
  USING (public.current_role_code() = 'responsable_caja')
  WITH CHECK (public.current_role_code() = 'responsable_caja');

-- Cuentas de ejemplo (ficticias), como la cuenta anterior de la tienda
INSERT INTO public.cuentas_bancarias (banco, titular, numero, moneda, tipo_cuenta, orden) VALUES
  ('BANPRO', 'Ferretería Casa Hogar, S.A.', '1002-0034-5678', 'NIO', 'Corriente', 1),
  ('BANPRO', 'Ferretería Casa Hogar, S.A.', '1002-0034-9012', 'USD', 'Corriente', 2),
  ('LAFISE', 'Ferretería Casa Hogar, S.A.', '1301-4455-0021', 'NIO', 'Corriente', 3),
  ('LAFISE', 'Ferretería Casa Hogar, S.A.', '1301-4455-0039', 'USD', 'Ahorro', 4),
  ('BAC', 'Ferretería Casa Hogar, S.A.', '3605-1188-7720', 'NIO', 'Corriente', 5),
  ('BAC', 'Ferretería Casa Hogar, S.A.', '3605-1188-7746', 'USD', 'Corriente', 6)
ON CONFLICT (banco, numero) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.parametros_negocio (
  id smallint PRIMARY KEY DEFAULT 1,
  tipo_cambio_usd numeric(10,4) NOT NULL,
  actualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parametros_negocio_una_fila CHECK (id = 1),
  CONSTRAINT parametros_negocio_tipo_cambio_check CHECK (tipo_cambio_usd > 0)
);

-- Tipo de cambio oficial BCN 2026 (el mismo del estudio COCOMO)
INSERT INTO public.parametros_negocio (id, tipo_cambio_usd) VALUES (1, 36.6243)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.parametros_negocio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.parametros_negocio FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.parametros_negocio TO authenticated;

DROP POLICY IF EXISTS parametros_negocio_select ON public.parametros_negocio;
CREATE POLICY parametros_negocio_select ON public.parametros_negocio
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.actualizar_tipo_cambio(p_valor numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'Solo el Responsable de Caja puede cambiar el tipo de cambio.';
  END IF;

  IF p_valor IS NULL OR p_valor < 1 OR p_valor > 1000 THEN
    RAISE EXCEPTION 'Indique un tipo de cambio válido (córdobas por dólar).';
  END IF;

  UPDATE public.parametros_negocio
  SET tipo_cambio_usd = round(p_valor, 4), actualizado_por = auth.uid(), updated_at = now()
  WHERE id = 1;

  RETURN round(p_valor, 4);
END;
$$;


-- ---------------------------------------------------------
-- 3. LIBRETA DE DIRECCIONES DEL CLIENTE
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.direcciones_cliente (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_web_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.clientes_web(id) ON DELETE CASCADE,
  alias text NOT NULL,
  direccion text NOT NULL,
  referencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direcciones_cliente_alias_check CHECK (length(btrim(alias)) BETWEEN 1 AND 40),
  CONSTRAINT direcciones_cliente_direccion_check CHECK (length(btrim(direccion)) >= 5)
);

CREATE INDEX IF NOT EXISTS idx_direcciones_cliente ON public.direcciones_cliente (cliente_web_id);

ALTER TABLE public.direcciones_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direcciones_cliente FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, DELETE ON TABLE public.direcciones_cliente TO authenticated;
GRANT INSERT (alias, direccion, referencia) ON TABLE public.direcciones_cliente TO authenticated;
GRANT UPDATE (alias, direccion, referencia) ON TABLE public.direcciones_cliente TO authenticated;

DROP POLICY IF EXISTS direcciones_cliente_propias ON public.direcciones_cliente;
CREATE POLICY direcciones_cliente_propias ON public.direcciones_cliente
  FOR ALL TO authenticated
  USING (cliente_web_id = auth.uid())
  WITH CHECK (cliente_web_id = auth.uid() AND public.tipo_cuenta_actual() = 'cliente_web');


-- ---------------------------------------------------------
-- 4. PAGOS DE PEDIDOS WEB
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pagos_pedido_web (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id bigint NOT NULL REFERENCES public.pedidos_en_linea(id) ON DELETE CASCADE,
  metodo text NOT NULL,
  monto numeric(14,2) NOT NULL,
  moneda text NOT NULL DEFAULT 'NIO',
  monto_moneda numeric(14,2) NOT NULL,
  tipo_cambio numeric(10,4),
  cuenta_bancaria_id bigint REFERENCES public.cuentas_bancarias(id) ON DELETE SET NULL,
  banco text,
  cuenta_numero text,
  comprobante_path text,
  referencia text,
  tarjeta_marca text,
  tarjeta_ultimos4 text,
  autorizacion text,
  estado text NOT NULL,
  motivo text,
  revisado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revisado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagos_pedido_web_metodo_check CHECK (metodo IN ('transferencia', 'tarjeta')),
  CONSTRAINT pagos_pedido_web_moneda_check CHECK (moneda IN ('NIO', 'USD')),
  CONSTRAINT pagos_pedido_web_estado_check CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'por_reembolsar', 'reembolsado')),
  CONSTRAINT pagos_pedido_web_monto_check CHECK (monto > 0 AND monto_moneda > 0),
  CONSTRAINT pagos_pedido_web_ultimos4_check CHECK (tarjeta_ultimos4 IS NULL OR tarjeta_ultimos4 ~ '^[0-9]{4}$')
);

CREATE INDEX IF NOT EXISTS idx_pagos_pedido_web_pedido ON public.pagos_pedido_web (pedido_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagos_pedido_web_estado ON public.pagos_pedido_web (estado);

ALTER TABLE public.pagos_pedido_web ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pagos_pedido_web FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pagos_pedido_web TO authenticated;

-- Lectura directa solo para el personal; el cliente ve sus pagos con mis_pedidos_web()
DROP POLICY IF EXISTS pagos_pedido_web_select ON public.pagos_pedido_web;
CREATE POLICY pagos_pedido_web_select ON public.pagos_pedido_web
  FOR SELECT TO authenticated
  USING (public.current_role_code() = ANY (ARRAY['responsable_caja', 'vendedor', 'responsable_comercial', 'gerencia']));


-- ---------------------------------------------------------
-- 5. COMPROBANTES (Storage, bucket privado)
-- El cliente sube a su carpeta (<uid>/archivo); solo él y Caja
-- pueden verlos.
-- ---------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprobantes', 'comprobantes', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS comprobantes_insert_cliente ON storage.objects;
CREATE POLICY comprobantes_insert_cliente ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.tipo_cuenta_actual() = 'cliente_web'
  );

DROP POLICY IF EXISTS comprobantes_select ON storage.objects;
CREATE POLICY comprobantes_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.current_role_code() = 'responsable_caja'
    )
  );


-- ---------------------------------------------------------
-- 6. REGISTRO DEL PEDIDO (definición vigente; nace por validar
-- y la forma de pago es obligatoria)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_pedido_web(p_items jsonb, p_modalidad_entrega text DEFAULT 'retiro'::text, p_direccion_entrega text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text, p_metodo_pago text DEFAULT NULL::text)
 RETURNS TABLE(pedido_id bigint, numero text, total numeric, estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cliente public.clientes_web%ROWTYPE;
  v_modalidad text;
  v_metodo_pago text;
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

  -- Cédula y teléfono obligatorios (cuentas anteriores los completan en Mi cuenta)
  IF v_cliente.cedula IS NULL OR v_cliente.telefono IS NULL THEN
    RAISE EXCEPTION 'Antes de hacer un pedido, completá tu cédula y tu teléfono en "Mi cuenta".';
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

  v_metodo_pago := coalesce(nullif(lower(trim(coalesce(p_metodo_pago, ''))), ''), 'efectivo');

  IF v_metodo_pago IS NOT NULL
     AND v_metodo_pago NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'La forma de pago debe ser efectivo, tarjeta o transferencia.';
  END IF;

  v_numero := 'WEB-' ||
    lpad(nextval('public.pedido_web_numero_seq')::text, 6, '0');

  INSERT INTO public.pedidos_en_linea (
    numero,
    cliente_web_id,
    cliente_nombre,
    cliente_cedula,
    telefono,
    correo,
    modalidad_entrega,
    direccion_entrega,
    metodo_pago,
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
    v_cliente.cedula,
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
    v_metodo_pago,
    0, 0, 0,
    'pendiente_validacion',
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
      (1 - public.descuento_vigente(v_producto.descuento_porcentaje, v_producto.descuento_hasta) / 100),
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
    'pendiente_validacion'::text;
END;
$function$;


-- ---------------------------------------------------------
-- 7. PAGO POR TRANSFERENCIA (cliente)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_comprobante_pedido_web(
  p_pedido_id bigint,
  p_cuenta_id bigint,
  p_comprobante_path text,
  p_referencia text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_pedido record;
  v_cuenta record;
  v_tc numeric(10,4);
  v_pago_id bigint;
  v_path text := btrim(coalesce(p_comprobante_path, ''));
BEGIN
  IF auth.uid() IS NULL OR public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Debe iniciar sesión como cliente.';
  END IF;

  SELECT p.id, p.numero, p.estado, p.metodo_pago, p.total
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id AND p.cliente_web_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.metodo_pago <> 'transferencia' THEN
    RAISE EXCEPTION 'El pedido % no se paga por transferencia.', v_pedido.numero;
  END IF;

  IF v_pedido.estado <> 'pendiente_validacion' THEN
    RAISE EXCEPTION 'El pedido % ya no está esperando el pago.', v_pedido.numero;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pagos_pedido_web g
    WHERE g.pedido_id = p_pedido_id AND g.estado IN ('pendiente', 'aprobado')
  ) THEN
    RAISE EXCEPTION 'El pedido % ya tiene un comprobante en revisión o aprobado.', v_pedido.numero;
  END IF;

  IF v_path = '' OR v_path NOT LIKE auth.uid()::text || '/%' THEN
    RAISE EXCEPTION 'Debe adjuntar el comprobante de la transferencia.';
  END IF;

  SELECT c.id, c.banco, c.numero, c.moneda
  INTO v_cuenta
  FROM public.cuentas_bancarias c
  WHERE c.id = p_cuenta_id AND c.activa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seleccione una cuenta bancaria válida.';
  END IF;

  SELECT n.tipo_cambio_usd INTO v_tc FROM public.parametros_negocio n WHERE n.id = 1;

  INSERT INTO public.pagos_pedido_web (
    pedido_id, metodo, monto, moneda, monto_moneda, tipo_cambio,
    cuenta_bancaria_id, banco, cuenta_numero, comprobante_path, referencia, estado
  )
  VALUES (
    p_pedido_id,
    'transferencia',
    v_pedido.total,
    v_cuenta.moneda,
    CASE WHEN v_cuenta.moneda = 'USD' THEN round(v_pedido.total / v_tc, 2) ELSE v_pedido.total END,
    CASE WHEN v_cuenta.moneda = 'USD' THEN v_tc END,
    v_cuenta.id,
    v_cuenta.banco,
    v_cuenta.numero,
    v_path,
    nullif(btrim(coalesce(p_referencia, '')), ''),
    'pendiente'
  )
  RETURNING id INTO v_pago_id;

  UPDATE public.pedidos_en_linea
  SET motivo_estado = NULL, updated_at = now()
  WHERE id = p_pedido_id;

  RETURN v_pago_id;
END;
$$;


-- ---------------------------------------------------------
-- 8. PAGO CON TARJETA (pasarela SIMULADA)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.luhn_valido(p_numero text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_suma integer := 0;
  v_digito integer;
  v_doble boolean := false;
  i integer;
BEGIN
  IF p_numero !~ '^[0-9]{13,19}$' THEN
    RETURN false;
  END IF;

  FOR i IN REVERSE length(p_numero)..1 LOOP
    v_digito := substr(p_numero, i, 1)::integer;
    IF v_doble THEN
      v_digito := v_digito * 2;
      IF v_digito > 9 THEN
        v_digito := v_digito - 9;
      END IF;
    END IF;
    v_suma := v_suma + v_digito;
    v_doble := NOT v_doble;
  END LOOP;

  RETURN v_suma % 10 = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.pagar_pedido_web_tarjeta(
  p_pedido_id bigint,
  p_numero text,
  p_vencimiento text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_pedido record;
  v_numero text := regexp_replace(coalesce(p_numero, ''), '[^0-9]', '', 'g');
  v_marca text;
  v_mes integer;
  v_anio integer;
  v_aprobado boolean;
  v_motivo text;
  v_autorizacion text;
BEGIN
  IF auth.uid() IS NULL OR public.tipo_cuenta_actual() <> 'cliente_web' THEN
    RAISE EXCEPTION 'Debe iniciar sesión como cliente.';
  END IF;

  SELECT p.id, p.numero, p.estado, p.metodo_pago, p.total
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id AND p.cliente_web_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.metodo_pago <> 'tarjeta' THEN
    RAISE EXCEPTION 'El pedido % no se paga con tarjeta.', v_pedido.numero;
  END IF;

  IF v_pedido.estado <> 'pendiente_validacion'
     OR EXISTS (SELECT 1 FROM public.pagos_pedido_web g WHERE g.pedido_id = p_pedido_id AND g.estado = 'aprobado') THEN
    RAISE EXCEPTION 'El pedido % ya está pagado.', v_pedido.numero;
  END IF;

  IF NOT public.luhn_valido(v_numero) THEN
    RAISE EXCEPTION 'El número de tarjeta no es válido.';
  END IF;

  v_marca := CASE
    WHEN v_numero ~ '^4' THEN 'Visa'
    WHEN v_numero ~ '^(5[1-5]|2[2-7])' THEN 'Mastercard'
  END;

  IF v_marca IS NULL THEN
    RAISE EXCEPTION 'Solo se aceptan tarjetas Visa o Mastercard.';
  END IF;

  IF coalesce(p_vencimiento, '') !~ '^(0[1-9]|1[0-2])/[0-9]{2}$' THEN
    RAISE EXCEPTION 'Indique el vencimiento como MM/AA.';
  END IF;

  v_mes := substr(p_vencimiento, 1, 2)::integer;
  v_anio := 2000 + substr(p_vencimiento, 4, 2)::integer;

  IF (make_date(v_anio, v_mes, 1) + INTERVAL '1 month')::date <= (now() AT TIME ZONE 'America/Managua')::date THEN
    RAISE EXCEPTION 'La tarjeta está vencida.';
  END IF;

  -- Respuestas simuladas del banco emisor
  v_aprobado := v_numero NOT IN ('4000000000000002', '4000000000009995');
  v_motivo := CASE v_numero
    WHEN '4000000000000002' THEN 'Tarjeta rechazada por el banco emisor.'
    WHEN '4000000000009995' THEN 'Fondos insuficientes.'
  END;
  v_autorizacion := CASE WHEN v_aprobado THEN 'SIM-' || lpad(floor(random() * 1000000)::text, 6, '0') END;

  INSERT INTO public.pagos_pedido_web (
    pedido_id, metodo, monto, moneda, monto_moneda,
    tarjeta_marca, tarjeta_ultimos4, autorizacion, estado, motivo, revisado_at
  )
  VALUES (
    p_pedido_id, 'tarjeta', v_pedido.total, 'NIO', v_pedido.total,
    v_marca, right(v_numero, 4), v_autorizacion,
    CASE WHEN v_aprobado THEN 'aprobado' ELSE 'rechazado' END,
    v_motivo, now()
  );

  IF v_aprobado THEN
    UPDATE public.pedidos_en_linea
    SET estado = 'validado', motivo_estado = NULL, gestionado_at = now(), updated_at = now()
    WHERE id = p_pedido_id;
  END IF;

  RETURN jsonb_build_object(
    'aprobado', v_aprobado,
    'marca', v_marca,
    'ultimos4', right(v_numero, 4),
    'autorizacion', v_autorizacion,
    'mensaje', CASE WHEN v_aprobado THEN 'Pago aprobado.' ELSE v_motivo END
  );
END;
$$;


-- ---------------------------------------------------------
-- 9. REVISIÓN DE PAGOS (Responsable de Caja)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revisar_pago_pedido_web(
  p_pago_id bigint,
  p_aprobar boolean,
  p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_pago record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'Solo el Responsable de Caja puede validar pagos.';
  END IF;

  SELECT g.id, g.estado, g.metodo, g.pedido_id, p.numero, p.estado AS pedido_estado
  INTO v_pago
  FROM public.pagos_pedido_web g
  JOIN public.pedidos_en_linea p ON p.id = g.pedido_id
  WHERE g.id = p_pago_id
  FOR UPDATE OF g, p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago indicado no existe.';
  END IF;

  IF v_pago.estado <> 'pendiente' OR v_pago.metodo <> 'transferencia' THEN
    RAISE EXCEPTION 'Ese pago ya fue revisado.';
  END IF;

  IF v_pago.pedido_estado <> 'pendiente_validacion' THEN
    RAISE EXCEPTION 'El pedido % ya no está esperando la validación del pago.', v_pago.numero;
  END IF;

  IF p_aprobar THEN
    UPDATE public.pagos_pedido_web
    SET estado = 'aprobado', motivo = v_motivo, revisado_por = auth.uid(), revisado_at = now()
    WHERE id = p_pago_id;

    UPDATE public.pedidos_en_linea
    SET estado = 'validado', motivo_estado = NULL, gestionado_por = auth.uid(), gestionado_at = now(), updated_at = now()
    WHERE id = v_pago.pedido_id;
  ELSE
    IF v_motivo IS NULL OR length(v_motivo) < 3 THEN
      RAISE EXCEPTION 'Indique por qué se rechaza el comprobante.';
    END IF;

    -- El pedido sigue esperando: el cliente puede subir otro comprobante
    UPDATE public.pagos_pedido_web
    SET estado = 'rechazado', motivo = v_motivo, revisado_por = auth.uid(), revisado_at = now()
    WHERE id = p_pago_id;

    UPDATE public.pedidos_en_linea
    SET motivo_estado = 'Comprobante rechazado: ' || v_motivo, updated_at = now()
    WHERE id = v_pago.pedido_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reembolsar_pago_pedido_web(
  p_pago_id bigint,
  p_referencia text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_referencia text := nullif(btrim(coalesce(p_referencia, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'Solo el Responsable de Caja puede registrar reembolsos.';
  END IF;

  IF v_referencia IS NULL OR length(v_referencia) < 3 THEN
    RAISE EXCEPTION 'Indique la referencia del reembolso (número de transferencia o de anulación).';
  END IF;

  UPDATE public.pagos_pedido_web
  SET estado = 'reembolsado',
      motivo = concat_ws(' · ', motivo, 'Reembolso: ' || v_referencia),
      revisado_por = auth.uid(),
      revisado_at = now()
  WHERE id = p_pago_id AND estado = 'por_reembolsar';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese pago no está pendiente de reembolso.';
  END IF;
END;
$$;

-- Lista para Caja (Caja no lee pedidos_en_linea directamente)
CREATE OR REPLACE FUNCTION public.pagos_en_linea_caja()
RETURNS TABLE(
  pago_id bigint,
  estado text,
  metodo text,
  pedido_id bigint,
  pedido_numero text,
  pedido_estado text,
  cliente_nombre text,
  cliente_cedula text,
  total numeric,
  moneda text,
  monto_moneda numeric,
  tipo_cambio numeric,
  banco text,
  cuenta_numero text,
  comprobante_path text,
  referencia text,
  tarjeta_marca text,
  tarjeta_ultimos4 text,
  autorizacion text,
  motivo text,
  created_at timestamptz,
  revisado_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'Solo el Responsable de Caja puede consultar los pagos en línea.';
  END IF;

  RETURN QUERY
  SELECT
    g.id, g.estado, g.metodo, p.id, p.numero, p.estado, p.cliente_nombre, p.cliente_cedula,
    g.monto, g.moneda, g.monto_moneda, g.tipo_cambio, g.banco, g.cuenta_numero,
    g.comprobante_path, g.referencia, g.tarjeta_marca, g.tarjeta_ultimos4, g.autorizacion,
    g.motivo, g.created_at, g.revisado_at
  FROM public.pagos_pedido_web g
  JOIN public.pedidos_en_linea p ON p.id = g.pedido_id
  ORDER BY
    CASE g.estado WHEN 'pendiente' THEN 1 WHEN 'por_reembolsar' THEN 2 ELSE 3 END,
    g.created_at DESC
  LIMIT 300;
END;
$$;


-- ---------------------------------------------------------
-- 10. CAMBIO DE ESTADO (Vendedor y Bodega)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cambiar_estado_pedido_web(
  p_pedido_id bigint,
  p_estado text,
  p_motivo text DEFAULT NULL
)
RETURNS TABLE(pedido_id bigint, numero text, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid := auth.uid();
  v_rol text;
  v_pedido record;
  v_estado text := lower(btrim(coalesce(p_estado, '')));
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_faltante record;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  v_rol := coalesce(public.current_role_code(), '');

  IF v_estado NOT IN ('validado', 'rechazado', 'en_despacho', 'entregado', 'cancelado') THEN
    RAISE EXCEPTION 'Estado de pedido no válido.';
  END IF;

  IF v_estado = 'entregado' AND v_rol <> 'almacen' THEN
    RAISE EXCEPTION 'Solo Bodega marca los pedidos como entregados.';
  END IF;

  IF v_estado <> 'entregado' AND v_rol <> 'vendedor' THEN
    RAISE EXCEPTION 'No tiene permisos para gestionar pedidos en línea.';
  END IF;

  IF v_estado IN ('rechazado', 'cancelado') AND (v_motivo IS NULL OR length(v_motivo) < 3) THEN
    RAISE EXCEPTION 'Debe indicar un motivo válido.';
  END IF;

  SELECT p.id, p.numero, p.estado, p.metodo_pago
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF NOT (
    (v_pedido.estado = 'pendiente_validacion' AND v_estado IN ('validado', 'rechazado', 'cancelado')) OR
    (v_pedido.estado = 'validado' AND v_estado IN ('en_despacho', 'cancelado')) OR
    (v_pedido.estado = 'en_despacho' AND v_estado = 'entregado')
  ) THEN
    RAISE EXCEPTION 'El pedido % no puede pasar de % a %.',
      v_pedido.numero, replace(v_pedido.estado, '_', ' '), replace(v_estado, '_', ' ');
  END IF;

  -- Los pagos anticipados se validan con el pago, no a mano
  IF v_estado = 'validado' AND v_pedido.metodo_pago <> 'efectivo' THEN
    RAISE EXCEPTION 'El pedido % se valida cuando se aprueba su pago (%).', v_pedido.numero, v_pedido.metodo_pago;
  END IF;

  -- Al validar un pedido en efectivo: verificar existencias (aún no se descuentan)
  IF v_estado = 'validado' THEN
    SELECT pr.nombre, SUM(d.cantidad) AS solicitado, COALESCE(MAX(e.cantidad), 0) AS disponible
    INTO v_faltante
    FROM public.detalle_pedidos_en_linea d
    JOIN public.productos pr ON pr.id = d.producto_id
    LEFT JOIN public.existencias e ON e.producto_id = d.producto_id
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id, pr.nombre, pr.activo
    HAVING NOT pr.activo OR SUM(d.cantidad) > COALESCE(MAX(e.cantidad), 0)
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'No hay existencia suficiente de %. Disponible: %, solicitado: %.',
        v_faltante.nombre, v_faltante.disponible, v_faltante.solicitado;
    END IF;
  END IF;

  -- Pasar a despacho crea la venta y descuenta el inventario
  IF v_estado = 'en_despacho' THEN
    PERFORM * FROM public.convertir_pedido_web_en_venta(p_pedido_id);

    RETURN QUERY SELECT v_pedido.id::bigint, v_pedido.numero::text, 'en_despacho'::text;
    RETURN;
  END IF;

  IF v_estado IN ('rechazado', 'cancelado') THEN
    -- Pagos en revisión: se descartan; pagos aprobados: a reembolsar
    UPDATE public.pagos_pedido_web
    SET estado = 'rechazado', motivo = 'Pedido ' || v_estado || ': ' || v_motivo, revisado_por = v_usuario, revisado_at = now()
    WHERE pedido_id = p_pedido_id AND estado = 'pendiente';

    UPDATE public.pagos_pedido_web
    SET estado = 'por_reembolsar', motivo = 'Pedido ' || v_estado || ': ' || v_motivo
    WHERE pedido_id = p_pedido_id AND estado = 'aprobado';
  END IF;

  UPDATE public.pedidos_en_linea
  SET
    estado = v_estado,
    motivo_estado = CASE WHEN v_estado IN ('rechazado', 'cancelado') THEN v_motivo ELSE motivo_estado END,
    gestionado_por = CASE WHEN v_estado = 'entregado' THEN gestionado_por ELSE v_usuario END,
    gestionado_at = CASE WHEN v_estado = 'entregado' THEN gestionado_at ELSE now() END,
    entregado_por = CASE WHEN v_estado = 'entregado' THEN v_usuario ELSE entregado_por END,
    entregado_at = CASE WHEN v_estado = 'entregado' THEN now() ELSE entregado_at END,
    updated_at = now()
  WHERE id = p_pedido_id;

  RETURN QUERY SELECT v_pedido.id::bigint, v_pedido.numero::text, v_estado;
END;
$$;


-- ---------------------------------------------------------
-- 11. DESPACHO: el pedido validado se convierte en venta
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.convertir_pedido_web_en_venta(p_pedido_id bigint)
RETURNS TABLE(pedido_id bigint, venta_id bigint, venta_numero text, venta_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid := auth.uid();
  v_pedido record;
  v_items jsonb;
  v_venta_id bigint;
  v_venta_numero text;
  v_venta_total numeric(14,2);
  v_pago record;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'vendedor' THEN
    RAISE EXCEPTION 'Solo el vendedor puede pasar pedidos a despacho.';
  END IF;

  SELECT p.id, p.numero, p.estado, p.cliente_id, p.cliente_nombre, p.venta_id, p.metodo_pago, p.total
  INTO v_pedido
  FROM public.pedidos_en_linea p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.venta_id IS NOT NULL THEN
    RAISE EXCEPTION 'El pedido % ya tiene una venta registrada.', v_pedido.numero;
  END IF;

  IF v_pedido.estado <> 'validado' THEN
    RAISE EXCEPTION 'El pedido % debe estar validado para pasar a despacho (estado actual: %).',
      v_pedido.numero, replace(v_pedido.estado, '_', ' ');
  END IF;

  -- Agrupar por producto: registrar_venta no admite repetidos.
  SELECT jsonb_agg(jsonb_build_object('producto_id', x.producto_id, 'cantidad', x.cantidad))
  INTO v_items
  FROM (
    SELECT d.producto_id, SUM(d.cantidad) AS cantidad
    FROM public.detalle_pedidos_en_linea d
    WHERE d.pedido_id = p_pedido_id
    GROUP BY d.producto_id
  ) x;

  IF v_items IS NULL THEN
    RAISE EXCEPTION 'El pedido % no contiene productos.', v_pedido.numero;
  END IF;

  -- registrar_venta descuenta el inventario con bloqueo FOR UPDATE
  SELECT r.venta_id, r.numero, r.total
  INTO v_venta_id, v_venta_numero, v_venta_total
  FROM public.registrar_venta(v_items, 'contado', v_pedido.cliente_id, v_pedido.cliente_nombre, NULL, NULL, v_pedido.numero) AS r;

  -- Se respeta el precio con que el cliente hizo el pedido
  IF v_venta_total IS DISTINCT FROM v_pedido.total THEN
    UPDATE public.detalle_ventas dv
    SET precio_unitario = round(x.subtotal / x.cantidad, 2),
        descuento_porcentaje = 0,
        subtotal = x.subtotal
    FROM (
      SELECT d.producto_id, SUM(d.cantidad) AS cantidad, SUM(d.subtotal) AS subtotal
      FROM public.detalle_pedidos_en_linea d
      WHERE d.pedido_id = p_pedido_id
      GROUP BY d.producto_id
    ) x
    WHERE dv.venta_id = v_venta_id AND dv.producto_id = x.producto_id;

    UPDATE public.ventas
    SET subtotal = v_pedido.total, descuento = 0, total = v_pedido.total, updated_at = now()
    WHERE id = v_venta_id;

    v_venta_total := v_pedido.total;
  END IF;

  UPDATE public.ventas
  SET metodo_pago_preferido = v_pedido.metodo_pago
  WHERE id = v_venta_id;

  -- Pagado en línea (tarjeta o transferencia aprobada): la venta queda pagada
  SELECT g.metodo, g.banco, g.cuenta_numero, g.referencia, g.autorizacion, g.tarjeta_marca, g.tarjeta_ultimos4
  INTO v_pago
  FROM public.pagos_pedido_web g
  WHERE g.pedido_id = p_pedido_id AND g.estado = 'aprobado'
  ORDER BY g.created_at DESC, g.id DESC
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.pagos_venta (venta_id, metodo_pago, monto, monto_recibido, cambio, referencia, creado_por)
    VALUES (
      v_venta_id,
      v_pago.metodo,
      v_venta_total,
      v_venta_total,
      0,
      left(concat_ws(' · ',
        'Pedido ' || v_pedido.numero,
        CASE WHEN v_pago.metodo = 'tarjeta'
          THEN v_pago.tarjeta_marca || ' ****' || v_pago.tarjeta_ultimos4 || ' aut. ' || v_pago.autorizacion
          ELSE v_pago.banco || ' ' || v_pago.cuenta_numero || coalesce(' ref. ' || v_pago.referencia, '')
        END
      ), 200),
      v_usuario
    );

    UPDATE public.ventas SET estado = 'pagada', updated_at = now() WHERE id = v_venta_id;
  END IF;

  UPDATE public.pedidos_en_linea
  SET estado = 'en_despacho',
      venta_id = v_venta_id,
      gestionado_por = v_usuario,
      gestionado_at = now(),
      despachado_por = v_usuario,
      despachado_at = now(),
      updated_at = now()
  WHERE id = p_pedido_id;

  RETURN QUERY SELECT v_pedido.id::bigint, v_venta_id, v_venta_numero, v_venta_total;
END;
$$;


-- ---------------------------------------------------------
-- 12. CANCELACIÓN POR EL CLIENTE (antes de validarse)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancelar_mi_pedido_web(p_pedido_id bigint, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
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
  WHERE p.id = p_pedido_id AND p.cliente_web_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido indicado no existe.';
  END IF;

  IF v_pedido.estado <> 'pendiente_validacion' THEN
    RAISE EXCEPTION
      'El pedido % ya fue validado y no puede cancelarse desde la tienda. Comuníquese con Casa Hogar.',
      v_pedido.numero;
  END IF;

  UPDATE public.pagos_pedido_web
  SET estado = 'rechazado', motivo = 'Pedido cancelado por el cliente.', revisado_at = now()
  WHERE pedido_id = p_pedido_id AND estado = 'pendiente';

  UPDATE public.pedidos_en_linea
  SET estado = 'cancelado',
      motivo_estado = COALESCE(nullif(btrim(coalesce(p_motivo, '')), ''), 'Cancelado por el cliente.'),
      gestionado_por = auth.uid(),
      gestionado_at = now(),
      updated_at = now()
  WHERE id = p_pedido_id;
END;
$$;


-- ---------------------------------------------------------
-- 13. MIS PEDIDOS: con el estado del último pago
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.mis_pedidos_web();

CREATE OR REPLACE FUNCTION public.mis_pedidos_web()
RETURNS TABLE(
  id bigint,
  numero text,
  created_at timestamp with time zone,
  modalidad_entrega text,
  total numeric,
  estado text,
  direccion_entrega text,
  observaciones text,
  motivo_estado text,
  metodo_pago text,
  venta_estado text,
  pago_estado text,
  pago_motivo text,
  pago_detalle text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
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
    p.motivo_estado,
    p.metodo_pago,
    v.estado,
    g.estado,
    g.motivo,
    CASE
      WHEN g.metodo = 'tarjeta' THEN g.tarjeta_marca || ' terminada en ' || g.tarjeta_ultimos4
      WHEN g.metodo = 'transferencia' THEN g.banco || ' · ' || g.cuenta_numero ||
        CASE WHEN g.moneda = 'USD' THEN ' · US$' || to_char(g.monto_moneda, 'FM999,999,990.00') ELSE '' END
    END
  FROM public.pedidos_en_linea p
  LEFT JOIN public.ventas v ON v.id = p.venta_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.pagos_pedido_web x
    WHERE x.pedido_id = p.id
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT 1
  ) g ON true
  WHERE p.cliente_web_id = auth.uid()
  ORDER BY p.created_at DESC;
END;
$$;


-- ---------------------------------------------------------
-- 14. INDICADORES QUE CUENTAN PEDIDOS (estados nuevos)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dashboard_propietario()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'pendiente_validacion',
    'validado',
    'en_despacho'
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
$function$;

CREATE OR REPLACE FUNCTION public.alertas_supervision_gerencia()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Managua')::date;
  v_alertas jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'gerencia' THEN
    RAISE EXCEPTION 'No tiene permisos para consultar el panel de supervisión.';
  END IF;

  WITH
  inventario AS (
    SELECT
      'inventario'::text AS area,
      CASE
        WHEN r.existencia <= 0 AND r.en_camino <= 0 THEN 'critica'
        WHEN r.en_camino > 0 AND r.cantidad_sugerida <= 0 THEN 'media'
        ELSE 'alta'
      END AS prioridad,
      now() AS fecha,
      r.codigo AS referencia,
      CASE
        WHEN r.existencia <= 0 THEN 'Producto agotado'
        ELSE 'Stock bajo'
      END AS titulo,
      r.nombre ||
        CASE
          WHEN r.existencia <= 0 THEN ' está agotado'
          ELSE ' tiene ' || public.texto_cantidad(r.existencia) ||
               ' (mínimo ' || public.texto_cantidad(r.stock_minimo) || ')'
        END ||
        CASE
          WHEN r.en_camino > 0 THEN
            '. Hay ' || public.texto_cantidad(r.en_camino) || ' en camino en compras pendientes.'
          ELSE '. No hay ninguna compra en camino.'
        END AS mensaje,
      CASE
        WHEN r.en_camino > 0 AND r.cantidad_sugerida > 0 THEN
          'Lo pedido no alcanza: el Encargado de Compras debería agregar ' ||
          public.texto_cantidad(r.cantidad_sugerida) || ' más.'
        WHEN r.en_camino > 0 THEN
          'Dar seguimiento a la autorización y recepción de esa compra.'
        ELSE
          'Pedir al Encargado de Compras que registre la reposición (sugerido: ' ||
          public.texto_cantidad(r.cantidad_sugerida) || ').'
      END AS accion,
      CASE
        WHEN r.en_camino > 0 THEN 'compras-consulta'
        ELSE 'inventario-consulta'
      END AS modulo
    FROM public.reposicion_sugerida() r
  ),

  compras_por_autorizar AS (
    SELECT
      'compras'::text,
      CASE WHEN c.created_at < now() - INTERVAL '3 days' THEN 'alta' ELSE 'media' END,
      c.created_at,
      c.numero,
      'Compra esperando autorización',
      'La compra ' || c.numero || ' a ' || COALESCE(pv.nombre, 'un proveedor') ||
        ' por ' || public.texto_cordobas(c.total) ||
        ' espera autorización desde el ' ||
        to_char(c.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      'Pedir al Responsable de Compras que la autorice o la anule.',
      'compras-consulta'
    FROM public.compras c
    LEFT JOIN public.proveedores pv
      ON pv.id = c.proveedor_id
    WHERE c.estado = 'registrada'
      AND c.created_at < now() - INTERVAL '1 day'
  ),

  compras_por_recibir AS (
    SELECT
      'compras'::text,
      CASE
        WHEN COALESCE(c.autorizada_at, c.created_at) < now() - INTERVAL '5 days' THEN 'alta'
        ELSE 'media'
      END,
      COALESCE(c.autorizada_at, c.created_at),
      c.numero,
      'Compra autorizada sin recibir',
      'La compra ' || c.numero || ' a ' || COALESCE(pv.nombre, 'un proveedor') ||
        ' por ' || public.texto_cordobas(c.total) || ' se autorizó el ' ||
        to_char(COALESCE(c.autorizada_at, c.created_at) AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') ||
        ' y todavía no llega a bodega.',
      'Confirmar con el proveedor la fecha de entrega y avisar a Bodega.',
      'recepciones-consulta'
    FROM public.compras c
    LEFT JOIN public.proveedores pv
      ON pv.id = c.proveedor_id
    WHERE c.estado = 'autorizada'
  ),

  ventas_sin_cobrar AS (
    SELECT
      'ventas'::text,
      'alta'::text,
      v.created_at,
      v.numero,
      'Venta sin cobrar',
      'La venta ' || v.numero || ' a ' || COALESCE(NULLIF(v.cliente_nombre, ''), 'cliente sin nombre') ||
        ' por ' || public.texto_cordobas(v.total) || ' se registró el ' ||
        to_char(v.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') ||
        ' y no se ha cobrado; su mercadería sigue apartada.',
      'Confirmar con el cliente. Si no va a pagar, el Responsable Comercial debe anularla para devolver el stock.',
      'ventas'
    FROM public.ventas v
    WHERE v.estado = 'pendiente_cobro'
      AND v.created_at < now() - INTERVAL '1 day'
  ),

  pedidos_web AS (
    SELECT
      'ventas'::text,
      CASE WHEN coalesce(p.gestionado_at, p.created_at) < now() - INTERVAL '2 days' THEN 'alta' ELSE 'media' END,
      p.created_at,
      p.numero,
      CASE p.estado
        WHEN 'pendiente_validacion' THEN 'Pedido en línea por validar'
        WHEN 'validado' THEN 'Pedido validado sin despachar'
        ELSE 'Pedido en despacho sin entregar'
      END,
      'El pedido ' || p.numero || ' de ' || COALESCE(NULLIF(p.cliente_nombre, ''), 'un cliente') ||
        ' (pago: ' || p.metodo_pago || ') está "' || replace(p.estado, '_', ' ') || '" desde el ' ||
        to_char(coalesce(p.gestionado_at, p.created_at) AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      CASE
        WHEN p.estado = 'pendiente_validacion' AND p.metodo_pago = 'transferencia'
             AND EXISTS (SELECT 1 FROM public.pagos_pedido_web g WHERE g.pedido_id = p.id AND g.estado = 'pendiente')
          THEN 'El Responsable de Caja debe revisar el comprobante de la transferencia.'
        WHEN p.estado = 'pendiente_validacion' AND p.metodo_pago = 'transferencia'
          THEN 'Falta que el cliente suba el comprobante; si no lo hace, el Vendedor puede rechazar el pedido.'
        WHEN p.estado = 'pendiente_validacion' AND p.metodo_pago = 'tarjeta'
          THEN 'El pago con tarjeta no se completó; el Vendedor puede contactar al cliente.'
        WHEN p.estado = 'pendiente_validacion'
          THEN 'El Vendedor debe validarlo (existencias y datos de entrega).'
        WHEN p.estado = 'validado'
          THEN 'El Vendedor debe pasarlo a despacho.'
        ELSE 'Bodega debe entregarlo al cliente.'
      END,
      'pedidos-en-linea'
    FROM public.pedidos_en_linea p
    WHERE p.estado IN ('pendiente_validacion', 'validado', 'en_despacho')
  ),

  reembolsos AS (
    SELECT
      'caja'::text,
      'alta'::text,
      g.created_at,
      p.numero,
      'Reembolso pendiente',
      'El pedido ' || p.numero || ' se canceló después de pagarse: falta devolver ' ||
        public.texto_cordobas(g.monto) || ' a ' || COALESCE(NULLIF(p.cliente_nombre, ''), 'el cliente') || '.',
      'El Responsable de Caja debe hacer el reembolso y registrarlo.',
      'pedidos-en-linea'
    FROM public.pagos_pedido_web g
    JOIN public.pedidos_en_linea p ON p.id = g.pedido_id
    WHERE g.estado = 'por_reembolsar'
  ),

  devoluciones AS (
    SELECT
      'ventas'::text,
      CASE
        WHEN d.estado = 'registrada' AND d.created_at < now() - INTERVAL '2 days' THEN 'alta'
        ELSE 'media'
      END,
      COALESCE(d.confirmada_at, d.created_at),
      d.numero,
      CASE
        WHEN d.estado = 'registrada' THEN 'Devolución por revisar'
        ELSE 'Reembolso pendiente'
      END,
      CASE
        WHEN d.estado = 'registrada' THEN
          'La devolución ' || d.numero || ' de la venta ' || v.numero ||
          ' por ' || public.texto_cordobas(d.total) || ' espera revisión desde el ' ||
          to_char(d.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.'
        ELSE
          'La devolución ' || d.numero || ' está confirmada y falta entregar el reembolso de ' ||
          public.texto_cordobas(d.monto_reembolso) || '.'
      END,
      CASE
        WHEN d.estado = 'registrada' THEN 'El Responsable Comercial debe confirmarla o anularla.'
        ELSE 'El Responsable de Caja debe registrar el reembolso.'
      END,
      'devoluciones-venta'
    FROM public.devoluciones_venta d
    JOIN public.ventas v
      ON v.id = d.venta_id
    WHERE d.estado = 'registrada'
       OR (d.estado = 'confirmada' AND d.estado_financiero = 'pendiente_reembolso')
  ),

  cartera AS (
    SELECT
      'cartera'::text,
      CASE
        WHEN c.fecha_vencimiento < v_hoy - 30 THEN 'critica'
        WHEN c.fecha_vencimiento < v_hoy THEN 'alta'
        ELSE 'media'
      END,
      c.fecha_vencimiento::timestamptz,
      v.numero,
      CASE
        WHEN c.fecha_vencimiento < v_hoy THEN 'Cuenta por cobrar vencida'
        ELSE 'Cuenta por vencer'
      END,
      COALESCE(NULLIF(v.cliente_nombre, ''), 'Un cliente') || ' debe ' ||
        public.texto_cordobas(c.saldo_pendiente) || ' de la venta ' || v.numero ||
        CASE
          WHEN c.fecha_vencimiento < v_hoy THEN
            '; venció el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') ||
            ' (hace ' || (v_hoy - c.fecha_vencimiento) || ' días).'
          ELSE
            '; vence el ' || to_char(c.fecha_vencimiento, 'DD/MM/YYYY') || '.'
        END,
      CASE
        WHEN c.fecha_vencimiento < v_hoy THEN
          'Contactar al cliente para acordar el pago y no darle más crédito hasta que se ponga al día.'
        ELSE 'Recordarle al cliente la fecha de pago.'
      END,
      'cuentas-por-cobrar'
    FROM public.cuentas_por_cobrar c
    JOIN public.ventas v
      ON v.id = c.venta_id
    WHERE c.saldo_pendiente > 0
      AND v.estado <> 'anulada'
      AND c.fecha_vencimiento <= v_hoy + 3
  ),

  cajas_abiertas AS (
    SELECT
      'caja'::text,
      'alta'::text,
      s.fecha_apertura,
      s.numero,
      'Caja sin cerrar',
      'La caja ' || s.numero || ' sigue abierta desde el ' ||
        to_char(s.fecha_apertura AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || '.',
      'El Responsable de Caja debe hacer el arqueo y cerrarla al final de cada jornada.',
      'caja-historial'
    FROM public.sesiones_caja s
    WHERE s.estado = 'abierta'
      AND (s.fecha_apertura AT TIME ZONE 'America/Managua')::date < v_hoy
  ),

  arqueos AS (
    SELECT
      'caja'::text,
      CASE
        WHEN abs(a.diferencia) >= 500 THEN 'critica'
        WHEN a.diferencia < 0 THEN 'alta'
        ELSE 'media'
      END,
      a.created_at,
      s.numero,
      'Arqueo con diferencia',
      'El arqueo de ' || s.numero || ' (' ||
        to_char(a.created_at AT TIME ZONE 'America/Managua', 'DD/MM/YYYY') || ') tuvo ' ||
        concat_ws(
          ', ',
          CASE
            WHEN a.diferencia < 0 THEN 'un faltante de ' || public.texto_cordobas(-a.diferencia) || ' en efectivo'
            WHEN a.diferencia > 0 THEN 'un sobrante de ' || public.texto_cordobas(a.diferencia) || ' en efectivo'
          END,
          CASE
            WHEN COALESCE(a.tarjeta_contado - a.tarjeta_esperado, 0) <> 0 THEN
              'una diferencia de ' || public.texto_cordobas(abs(a.tarjeta_contado - a.tarjeta_esperado)) || ' en tarjeta'
          END,
          CASE
            WHEN COALESCE(a.transferencia_contado - a.transferencia_esperado, 0) <> 0 THEN
              'una diferencia de ' || public.texto_cordobas(abs(a.transferencia_contado - a.transferencia_esperado)) || ' en transferencias'
          END
        ) || '.' ||
        COALESCE(' Motivo: ' || NULLIF(a.observaciones, ''), ''),
      'Revisar con el Responsable de Caja los cobros y salidas de esa jornada.',
      'caja-historial'
    FROM public.arqueos_caja a
    JOIN public.sesiones_caja s
      ON s.id = a.sesion_caja_id
    WHERE a.created_at >= now() - INTERVAL '30 days'
      AND (
        a.diferencia <> 0
        OR COALESCE(a.tarjeta_contado - a.tarjeta_esperado, 0) <> 0
        OR COALESCE(a.transferencia_contado - a.transferencia_esperado, 0) <> 0
      )
  ),

  ofertas AS (
    SELECT
      'ventas'::text,
      'baja'::text,
      p.descuento_hasta::timestamptz,
      p.codigo,
      'Oferta por terminar',
      'La oferta de ' || p.nombre || ' (−' || public.texto_cantidad(p.descuento_porcentaje) ||
        ' %) termina el ' || to_char(p.descuento_hasta, 'DD/MM/YYYY') || '.',
      'Si conviene extenderla, el Responsable Comercial puede cambiar la fecha.',
      'productos-consulta'
    FROM public.productos p
    WHERE p.activo = true
      AND p.descuento_porcentaje > 0
      AND p.descuento_hasta BETWEEN v_hoy AND v_hoy + 3
  ),

  todas AS (
    SELECT * FROM inventario
    UNION ALL SELECT * FROM compras_por_autorizar
    UNION ALL SELECT * FROM compras_por_recibir
    UNION ALL SELECT * FROM ventas_sin_cobrar
    UNION ALL SELECT * FROM pedidos_web
    UNION ALL SELECT * FROM reembolsos
    UNION ALL SELECT * FROM devoluciones
    UNION ALL SELECT * FROM cartera
    UNION ALL SELECT * FROM cajas_abiertas
    UNION ALL SELECT * FROM arqueos
    UNION ALL SELECT * FROM ofertas
  )

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'area', t.area,
        'prioridad', t.prioridad,
        'fecha', t.fecha,
        'referencia', t.referencia,
        'titulo', t.titulo,
        'mensaje', t.mensaje,
        'accion', t.accion,
        'modulo', t.modulo
      )
      ORDER BY
        CASE t.prioridad
          WHEN 'critica' THEN 1
          WHEN 'alta' THEN 2
          WHEN 'media' THEN 3
          ELSE 4
        END,
        t.fecha ASC
    ),
    '[]'::jsonb
  )
  INTO v_alertas
  FROM todas t;

  RETURN jsonb_build_object(
    'generado_en', now(),
    'resumen', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'criticas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'critica'),
        'altas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'alta'),
        'medias', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'media'),
        'bajas', COUNT(*) FILTER (WHERE x ->> 'prioridad' = 'baja')
      )
      FROM jsonb_array_elements(v_alertas) x
    ),
    'alertas', v_alertas
  );
END;
$function$;


-- ---------------------------------------------------------
-- 15. PRIVILEGIOS DE LAS FUNCIONES
-- ---------------------------------------------------------

ALTER FUNCTION public.actualizar_tipo_cambio(numeric) OWNER TO postgres;
ALTER FUNCTION public.registrar_comprobante_pedido_web(bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.luhn_valido(text) OWNER TO postgres;
ALTER FUNCTION public.pagar_pedido_web_tarjeta(bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.revisar_pago_pedido_web(bigint, boolean, text) OWNER TO postgres;
ALTER FUNCTION public.reembolsar_pago_pedido_web(bigint, text) OWNER TO postgres;
ALTER FUNCTION public.pagos_en_linea_caja() OWNER TO postgres;
ALTER FUNCTION public.mis_pedidos_web() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.actualizar_tipo_cambio(numeric) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.registrar_comprobante_pedido_web(bigint, bigint, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.luhn_valido(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pagar_pedido_web_tarjeta(bigint, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revisar_pago_pedido_web(bigint, boolean, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reembolsar_pago_pedido_web(bigint, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.pagos_en_linea_caja() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.mis_pedidos_web() FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.actualizar_tipo_cambio(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_comprobante_pedido_web(bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_pedido_web_tarjeta(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revisar_pago_pedido_web(bigint, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reembolsar_pago_pedido_web(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pagos_en_linea_caja() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mis_pedidos_web() TO authenticated;

COMMIT;
