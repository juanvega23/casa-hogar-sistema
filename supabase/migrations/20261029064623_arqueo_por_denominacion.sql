-- =========================================================
-- ARQUEO DE CAJA POR DENOMINACIÓN
--
-- Antes la cajera escribía un solo número (efectivo contado).
-- Ahora cuenta billetes y monedas por denominación y declara
-- los totales de vouchers de tarjeta y de transferencias; la
-- base calcula los totales y las diferencias por método:
--
--   efectivo esperado = fondo inicial + ingresos − egresos en efectivo
--   tarjeta / transferencia esperado = ingresos − egresos de ese método
--
-- Si hay cualquier diferencia, la observación es obligatoria.
-- El conteo queda guardado en el arqueo (detalle_efectivo).
--
-- Afecta:
--   arqueos_caja                (columnas nuevas; las filas anteriores
--                                quedan con ellas en NULL)
--   registrar_arqueo_caja(...)  (nueva firma: conteo por denominación)
-- cerrar_caja() y auditoria_sistema() no cambian: siguen usando
-- arqueos_caja.diferencia, que conserva su significado (efectivo).
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. COLUMNAS NUEVAS
-- ---------------------------------------------------------

ALTER TABLE public.arqueos_caja
  ADD COLUMN IF NOT EXISTS detalle_efectivo jsonb,
  ADD COLUMN IF NOT EXISTS tarjeta_esperado numeric(14,2),
  ADD COLUMN IF NOT EXISTS tarjeta_contado numeric(14,2),
  ADD COLUMN IF NOT EXISTS transferencia_esperado numeric(14,2),
  ADD COLUMN IF NOT EXISTS transferencia_contado numeric(14,2);

ALTER TABLE public.arqueos_caja
  DROP CONSTRAINT IF EXISTS arqueos_caja_metodos_contado_check;

ALTER TABLE public.arqueos_caja
  ADD CONSTRAINT arqueos_caja_metodos_contado_check CHECK (
    COALESCE(tarjeta_contado, 0) >= 0
    AND COALESCE(transferencia_contado, 0) >= 0
  );


-- ---------------------------------------------------------
-- 2. REGISTRO DEL ARQUEO
-- p_conteo: {"1000": 2, "500": 1, ..., "0.05": 3}
--   claves = denominaciones del córdoba; valores = cantidad
--   (entero ≥ 0). Las denominaciones que no vienen cuentan 0.
-- ---------------------------------------------------------

DROP FUNCTION IF EXISTS public.registrar_arqueo_caja(numeric, text);

CREATE OR REPLACE FUNCTION public.registrar_arqueo_caja(
  p_conteo jsonb,
  p_tarjeta_contado numeric DEFAULT 0,
  p_transferencia_contado numeric DEFAULT 0,
  p_observaciones text DEFAULT NULL
)
RETURNS TABLE (
  arqueo_id bigint,
  sesion_id bigint,
  efectivo_esperado numeric,
  efectivo_contado numeric,
  diferencia numeric,
  tarjeta_diferencia numeric,
  transferencia_diferencia numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  -- Billetes y monedas del córdoba en circulación
  c_denominaciones CONSTANT numeric[] := ARRAY[
    1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.50, 0.25, 0.10, 0.05
  ];
  v_usuario uuid;
  v_sesion_id bigint;
  v_monto_inicial numeric(14,2);
  v_clave text;
  v_valor jsonb;
  v_cantidad numeric;
  v_detalle jsonb := '{}'::jsonb;
  v_contado numeric(14,2) := 0;
  v_esperado numeric(14,2);
  v_diferencia numeric(14,2);
  v_tarjeta_esperado numeric(14,2);
  v_transferencia_esperado numeric(14,2);
  v_tarjeta_contado numeric(14,2);
  v_transferencia_contado numeric(14,2);
  v_observaciones text := NULLIF(TRIM(COALESCE(p_observaciones, '')), '');
  v_arqueo_id bigint;
BEGIN
  v_usuario := auth.uid();

  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado.';
  END IF;

  IF COALESCE(public.current_role_code(), '') <> 'responsable_caja' THEN
    RAISE EXCEPTION 'No tiene permisos para realizar arqueos.';
  END IF;

  IF p_conteo IS NULL OR jsonb_typeof(p_conteo) <> 'object' THEN
    RAISE EXCEPTION 'Debe indicar el conteo de billetes y monedas.';
  END IF;

  v_tarjeta_contado := round(COALESCE(p_tarjeta_contado, 0), 2);
  v_transferencia_contado := round(COALESCE(p_transferencia_contado, 0), 2);

  IF v_tarjeta_contado < 0 OR v_transferencia_contado < 0 THEN
    RAISE EXCEPTION 'Los totales de tarjeta y transferencia no pueden ser negativos.';
  END IF;

  -- Conteo: solo denominaciones válidas y cantidades enteras
  FOR v_clave, v_valor IN
    SELECT key, value FROM jsonb_each(p_conteo)
  LOOP
    IF v_clave !~ '^\d+(\.\d+)?$'
       OR NOT (v_clave::numeric = ANY (c_denominaciones)) THEN
      RAISE EXCEPTION 'Denominación no válida: %.', v_clave;
    END IF;

    IF jsonb_typeof(v_valor) <> 'number' THEN
      RAISE EXCEPTION 'La cantidad de C$% debe ser un número.', v_clave;
    END IF;

    v_cantidad := (v_valor #>> '{}')::numeric;

    IF v_cantidad < 0 OR v_cantidad <> trunc(v_cantidad) THEN
      RAISE EXCEPTION 'La cantidad de C$% debe ser un número entero sin signo.', v_clave;
    END IF;

    IF v_cantidad > 0 THEN
      v_detalle := v_detalle || jsonb_build_object(
        trim(to_char(v_clave::numeric, 'FM999990.00')),
        v_cantidad
      );
      v_contado := v_contado + v_clave::numeric * v_cantidad;
    END IF;
  END LOOP;

  v_contado := round(v_contado, 2);

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

  -- Esperado por método (misma regla que antes para el efectivo)
  SELECT
    round(
      COALESCE(v_monto_inicial, 0)
      + COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND m.metodo_pago = 'efectivo'), 0)
      - COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'egreso' AND m.metodo_pago = 'efectivo'), 0),
      2
    ),
    round(
      COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND m.metodo_pago = 'tarjeta'), 0)
      - COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'egreso' AND m.metodo_pago = 'tarjeta'), 0),
      2
    ),
    round(
      COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'ingreso' AND m.metodo_pago = 'transferencia'), 0)
      - COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'egreso' AND m.metodo_pago = 'transferencia'), 0),
      2
    )
  INTO v_esperado, v_tarjeta_esperado, v_transferencia_esperado
  FROM public.movimientos_caja m
  WHERE m.sesion_caja_id = v_sesion_id;

  v_esperado := GREATEST(COALESCE(v_esperado, 0), 0);
  v_tarjeta_esperado := GREATEST(COALESCE(v_tarjeta_esperado, 0), 0);
  v_transferencia_esperado := GREATEST(COALESCE(v_transferencia_esperado, 0), 0);

  v_diferencia := round(v_contado - v_esperado, 2);

  IF (
    v_diferencia <> 0
    OR v_tarjeta_contado <> v_tarjeta_esperado
    OR v_transferencia_contado <> v_transferencia_esperado
  ) AND v_observaciones IS NULL THEN
    RAISE EXCEPTION 'Hay diferencias en el arqueo: explica el motivo en las observaciones.';
  END IF;

  INSERT INTO public.arqueos_caja (
    sesion_caja_id,
    efectivo_esperado,
    efectivo_contado,
    diferencia,
    detalle_efectivo,
    tarjeta_esperado,
    tarjeta_contado,
    transferencia_esperado,
    transferencia_contado,
    observaciones,
    realizado_por
  )
  VALUES (
    v_sesion_id,
    v_esperado,
    v_contado,
    v_diferencia,
    v_detalle,
    v_tarjeta_esperado,
    v_tarjeta_contado,
    v_transferencia_esperado,
    v_transferencia_contado,
    v_observaciones,
    v_usuario
  )
  RETURNING id
  INTO v_arqueo_id;

  RETURN QUERY
  SELECT
    v_arqueo_id,
    v_sesion_id,
    v_esperado::numeric,
    v_contado::numeric,
    v_diferencia::numeric,
    (v_tarjeta_contado - v_tarjeta_esperado)::numeric,
    (v_transferencia_contado - v_transferencia_esperado)::numeric;
END;
$$;

ALTER FUNCTION public.registrar_arqueo_caja(jsonb, numeric, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.registrar_arqueo_caja(jsonb, numeric, numeric, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_arqueo_caja(jsonb, numeric, numeric, text) TO authenticated;

COMMIT;
