-- =========================================================
-- 017_purchase_role_permissions.sql
-- Separación de responsabilidades del Módulo Compras
--
-- Encargado de Compras:
--   - Registrar compras
--
-- Responsable de Compras:
--   - Autorizar compras
--   - Registrar devoluciones
--
-- Almacén:
--   - Registrar recepciones
--
-- Gerencia:
--   - Consulta / supervisión
-- =========================================================

BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_new text;
BEGIN

  -- =======================================================
  -- 1. REGISTRAR COMPRA
  -- Solo: encargado_compras
  -- =======================================================

  SELECT pg_get_functiondef(
    'public.registrar_compra(bigint,jsonb,text,date,text,text)'::regprocedure
  )
  INTO v_def;

  v_new := regexp_replace(
    v_def,
    $rx$
      if[[:space:]]+
      coalesce\(
        [[:space:]]*v_rol,
        [[:space:]]*''
        [[:space:]]*
      \)
      [[:space:]]+not[[:space:]]+in
      [[:space:]]*
      \(
        [[:space:]]*'almacen',
        [[:space:]]*'administracion',
        [[:space:]]*'gerencia'
        [[:space:]]*
      \)
      [[:space:]]+then
    $rx$,
    $new$
      if coalesce(v_rol, '') <> 'encargado_compras' then
    $new$,
    'x'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION
      'No se pudo actualizar la validación de rol de registrar_compra.';
  END IF;

  EXECUTE v_new;


  -- =======================================================
  -- 2. AUTORIZAR COMPRA
  -- Solo: responsable_compras
  -- =======================================================

  SELECT pg_get_functiondef(
    'public.autorizar_compra(bigint)'::regprocedure
  )
  INTO v_def;

  v_new := regexp_replace(
    v_def,
    $rx$
      if[[:space:]]+
      coalesce\(
        [[:space:]]*v_rol,
        [[:space:]]*''
        [[:space:]]*
      \)
      [[:space:]]+not[[:space:]]+in
      [[:space:]]*
      \(
        [[:space:]]*'administracion',
        [[:space:]]*'gerencia'
        [[:space:]]*
      \)
      [[:space:]]+then
    $rx$,
    $new$
      if coalesce(v_rol, '') <> 'responsable_compras' then
    $new$,
    'x'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION
      'No se pudo actualizar la validación de rol de autorizar_compra.';
  END IF;

  EXECUTE v_new;


  -- =======================================================
  -- 3. REGISTRAR RECEPCIÓN
  -- Solo: almacen
  -- =======================================================

  SELECT pg_get_functiondef(
    'public.registrar_recepcion_compra(bigint,jsonb,date,text)'::regprocedure
  )
  INTO v_def;

  v_new := regexp_replace(
    v_def,
    $rx$
      if[[:space:]]+
      coalesce\(
        [[:space:]]*v_rol,
        [[:space:]]*''
        [[:space:]]*
      \)
      [[:space:]]+not[[:space:]]+in
      [[:space:]]*
      \(
        [[:space:]]*'almacen',
        [[:space:]]*'administracion'
        [[:space:]]*
      \)
      [[:space:]]+then
    $rx$,
    $new$
      if coalesce(v_rol, '') <> 'almacen' then
    $new$,
    'x'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION
      'No se pudo actualizar la validación de rol de registrar_recepcion_compra.';
  END IF;

  EXECUTE v_new;


  -- =======================================================
  -- 4. REGISTRAR DEVOLUCIÓN
  -- Solo: responsable_compras
  -- =======================================================

  SELECT pg_get_functiondef(
    'public.registrar_devolucion_compra(bigint,jsonb,text,date,text)'::regprocedure
  )
  INTO v_def;

  v_new := regexp_replace(
    v_def,
    $rx$
      if[[:space:]]+
      coalesce\(
        [[:space:]]*v_rol,
        [[:space:]]*''
        [[:space:]]*
      \)
      [[:space:]]+not[[:space:]]+in
      [[:space:]]*
      \(
        [[:space:]]*'almacen',
        [[:space:]]*'administracion'
        [[:space:]]*
      \)
      [[:space:]]+then
    $rx$,
    $new$
      if coalesce(v_rol, '') <> 'responsable_compras' then
    $new$,
    'x'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION
      'No se pudo actualizar la validación de rol de registrar_devolucion_compra.';
  END IF;

  EXECUTE v_new;

END
$migration$;

COMMIT;