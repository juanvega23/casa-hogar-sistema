-- =========================================================
-- BAJA DE LOS ROLES ANTIGUOS 'ventas' Y 'administracion'
--
-- Se conservaban por compatibilidad mientras se migraba a los
-- roles actuales. Ninguna cuenta los usa, Soporte TI ya no los
-- asignaba y la auditoría no tiene registros de ellos. Seguían
-- dando permisos que hoy son de otros roles (por ejemplo,
-- 'ventas' podía abrir caja y cobrar), así que se quitan.
--
-- Afecta (solo se elimina el rol antiguo; los demás no cambian):
--   abrir_caja, cobrar_venta, registrar_abono_venta,
--   aplicar_devolucion_financiera, reembolsar_devolucion_venta
--                                   → solo responsable_caja
--   anular_compra                   → solo responsable_compras
--   registrar_movimiento_inventario → solo almacen
--   reportes_propietario            → propietario y gerencia
--   12 políticas SELECT          (se quitan los dos roles)
--   roles                           (filas 'ventas' y 'administracion')
-- No se tocan alertas_recomendaciones_propietario ni el área
-- 'ventas' de los reportes: ahí 'ventas' es un área, no un rol.
-- Privilegios: sin cambios (CREATE OR REPLACE conserva los GRANT).
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. POLÍTICAS DE LECTURA
-- ---------------------------------------------------------

ALTER POLICY "categorias_select_operativos" ON public.categorias
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "colores_select_operativos" ON public.colores
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "existencias_select_operativos" ON public.existencias
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "marcas_select_operativos" ON public.marcas
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "materiales_select_operativos" ON public.materiales
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "modelos_select_operativos" ON public.modelos
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "movimientos_caja_select" ON public.movimientos_caja
  USING (current_role_code() = ANY (ARRAY['responsable_caja'::text, 'gerencia'::text]));

ALTER POLICY "movimientos_select_operativos" ON public.movimientos_inventario
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "pagos_venta_select" ON public.pagos_venta
  USING (current_role_code() = ANY (ARRAY['responsable_caja'::text, 'gerencia'::text]));

ALTER POLICY "productos_select_operativos" ON public.productos
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "sesiones_caja_select" ON public.sesiones_caja
  USING (current_role_code() = ANY (ARRAY['responsable_caja'::text, 'gerencia'::text]));

ALTER POLICY "unidades_medida_select_operativos" ON public.unidades_medida
  USING (current_role_code() = ANY (ARRAY['gerencia'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));


-- ---------------------------------------------------------
-- 2. FUNCIONES
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.abrir_caja(p_monto_inicial numeric DEFAULT 0, p_observaciones text DEFAULT NULL::text)
 RETURNS TABLE(sesion_id bigint, numero text, estado text, fecha_apertura timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'responsable_caja'
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
$function$;


CREATE OR REPLACE FUNCTION public.cobrar_venta(p_venta_id bigint, p_metodo_pago text, p_monto_recibido numeric DEFAULT NULL::numeric, p_referencia text DEFAULT NULL::text)
 RETURNS TABLE(pago_id bigint, venta_id bigint, numero_venta text, total numeric, cambio numeric, estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'responsable_caja'
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
$function$;


CREATE OR REPLACE FUNCTION public.registrar_abono_venta(p_venta_id bigint, p_monto numeric, p_metodo_pago text, p_monto_recibido numeric DEFAULT NULL::numeric, p_referencia text DEFAULT NULL::text)
 RETURNS TABLE(pago_id bigint, venta_id bigint, numero_venta text, monto_abono numeric, saldo_anterior numeric, saldo_pendiente numeric, cambio numeric, estado_cuenta text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'responsable_caja'
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
$function$;


CREATE OR REPLACE FUNCTION public.aplicar_devolucion_financiera(p_devolucion_id bigint)
 RETURNS TABLE(devolucion_id bigint, numero text, monto_devolucion numeric, monto_aplicado_cxc numeric, monto_reembolso numeric, saldo_pendiente numeric, estado_financiero text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'responsable_caja'
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
$function$;


CREATE OR REPLACE FUNCTION public.reembolsar_devolucion_venta(p_devolucion_id bigint, p_metodo_pago text, p_referencia text DEFAULT NULL::text)
 RETURNS TABLE(movimiento_id bigint, devolucion_id bigint, numero_devolucion text, monto_reembolso numeric, metodo_pago text, estado_financiero text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'responsable_caja'
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
$function$;


CREATE OR REPLACE FUNCTION public.anular_compra(p_compra_id bigint, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_rol text;
  v_compra record;
BEGIN
  v_rol := public.current_role_code();

  IF COALESCE(v_rol, '') NOT IN (
    'responsable_compras'
  ) THEN
    RAISE EXCEPTION
      'Solo el Responsable de Compras puede anular una compra.';
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
$function$;


CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(p_producto_id bigint, p_tipo text, p_cantidad numeric, p_motivo text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.reportes_propietario(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'gerencia'
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
$function$;


-- ---------------------------------------------------------
-- 3. ROLES
-- La base no deja borrar un rol con cuentas asignadas
-- (profiles_role_id_fkey ON DELETE RESTRICT).
-- ---------------------------------------------------------

DELETE FROM public.roles
WHERE codigo IN ('ventas', 'administracion');

COMMIT;
