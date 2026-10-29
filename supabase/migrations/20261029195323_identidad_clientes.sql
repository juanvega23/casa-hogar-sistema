-- =========================================================
-- IDENTIDAD DE CLIENTES Y PROVEEDORES
--
-- Tienda en línea (clientes_web):
--   - Cédula nicaragüense obligatoria al registrarse, válida y única.
--     Formato 001-010190-0000M: municipio (3), fecha de nacimiento
--     ddmmaa (6), consecutivo (4) y letra verificadora. La letra es
--     la posición (número de 13 dígitos módulo 23) en
--     ABCDEFGHJKLMNPQRSTUVWXY. Además la fecha debe existir y la
--     persona tener al menos 16 años (edad a la que se emite).
--     No se puede comprobar que la cédula exista en el registro
--     del Estado: solo que esté bien formada y sea coherente.
--   - Teléfono de Nicaragua obligatorio y único: 8 dígitos que
--     empiezan por 2, 5, 7 u 8 (se guarda sin espacios, guiones
--     ni +505).
--   - El cliente puede agregar su cédula si no la tiene (cuentas
--     anteriores), pero no cambiarla después.
--   - registrar_pedido_web() exige cédula y teléfono y copia la
--     cédula al pedido (pedidos_en_linea.cliente_cedula), para que
--     el Vendedor verifique la identidad al entregar.
--
-- Clientes internos (clientes.identificacion) y proveedores (ruc):
--   - Persona natural: cédula válida. Empresa: RUC J + 13 dígitos.
--   - Únicos (normalizados), para no registrar dos veces al mismo.
--
-- Afecta:
--   normalizar_cedula(), cedula_nicaraguense_valida(),
--   cedula_fecha_nacimiento(), normalizar_telefono_ni(),
--   normalizar_ruc()                                (funciones nuevas)
--   clientes_web.cedula                             (columna nueva)
--   pedidos_en_linea.cliente_cedula                 (columna nueva)
--   triggers de validación en clientes_web, clientes y proveedores
--   índices únicos de cédula/teléfono/identificación/RUC
--   handle_new_user()       (cédula y teléfono obligatorios al registrarse)
--   registrar_pedido_web()  (exige cédula y teléfono; copia la cédula)
--   privilegio UPDATE(cedula) en clientes_web para authenticated
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. FUNCIONES DE NORMALIZACIÓN Y VALIDACIÓN
-- ---------------------------------------------------------

-- 001-010190-0000M (sin importar guiones, espacios o minúsculas)
CREATE OR REPLACE FUNCTION public.normalizar_cedula(p_cedula text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_cedula IS NULL OR btrim(p_cedula) = '' THEN NULL
    WHEN x ~ '^[0-9]{13}[A-Z]$' THEN substr(x, 1, 3) || '-' || substr(x, 4, 6) || '-' || substr(x, 10, 5)
    ELSE upper(btrim(p_cedula))
  END
  FROM (SELECT upper(regexp_replace(coalesce(p_cedula, ''), '[^0-9A-Za-z]', '', 'g')) AS x) s;
$$;

-- Formato, fecha posible y letra verificadora. La fecha se acepta si
-- existe en 19aa o en 20aa (el 29 de febrero depende del siglo).
CREATE OR REPLACE FUNCTION public.cedula_nicaraguense_valida(p_cedula text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  x text := upper(regexp_replace(coalesce(p_cedula, ''), '[^0-9A-Za-z]', '', 'g'));
  v_dia integer;
  v_mes integer;
  v_anio integer;
  v_fecha_ok boolean := false;
BEGIN
  IF x !~ '^[0-9]{13}[A-Z]$' THEN
    RETURN false;
  END IF;

  v_dia := substr(x, 4, 2)::integer;
  v_mes := substr(x, 6, 2)::integer;
  v_anio := substr(x, 8, 2)::integer;

  BEGIN
    PERFORM make_date(1900 + v_anio, v_mes, v_dia);
    v_fecha_ok := true;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF NOT v_fecha_ok THEN
    BEGIN
      PERFORM make_date(2000 + v_anio, v_mes, v_dia);
      v_fecha_ok := true;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  IF NOT v_fecha_ok THEN
    RETURN false;
  END IF;

  RETURN substr(
    'ABCDEFGHJKLMNPQRSTUVWXY',
    (substr(x, 1, 13)::numeric % 23)::integer + 1,
    1
  ) = substr(x, 14, 1);
END;
$$;

-- Fecha de nacimiento: siglo 2000 salvo que quede en el futuro.
CREATE OR REPLACE FUNCTION public.cedula_fecha_nacimiento(p_cedula text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  x text := upper(regexp_replace(coalesce(p_cedula, ''), '[^0-9A-Za-z]', '', 'g'));
  v_anio integer;
BEGIN
  IF x !~ '^[0-9]{13}[A-Z]$' THEN
    RETURN NULL;
  END IF;

  v_anio := 2000 + substr(x, 8, 2)::integer;

  IF v_anio > extract(year FROM (now() AT TIME ZONE 'America/Managua'))::integer THEN
    v_anio := v_anio - 100;
  END IF;

  RETURN make_date(v_anio, substr(x, 6, 2)::integer, substr(x, 4, 2)::integer);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- 8 dígitos sin espacios, guiones ni +505.
CREATE OR REPLACE FUNCTION public.normalizar_telefono_ni(p_telefono text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_telefono IS NULL OR btrim(p_telefono) = '' THEN NULL
    WHEN length(x) = 11 AND x LIKE '505%' THEN substr(x, 4)
    WHEN x = '' THEN btrim(p_telefono)
    ELSE x
  END
  FROM (SELECT regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g') AS x) s;
$$;

-- RUC: si parece cédula se normaliza como cédula; si no, sin
-- separadores y en mayúsculas (J0310000000000).
CREATE OR REPLACE FUNCTION public.normalizar_ruc(p_ruc text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_ruc IS NULL OR btrim(p_ruc) = '' THEN NULL
    WHEN x ~ '^[0-9]{13}[A-Z]$' THEN public.normalizar_cedula(x)
    ELSE x
  END
  FROM (SELECT upper(regexp_replace(coalesce(p_ruc, ''), '[^0-9A-Za-z]', '', 'g')) AS x) s;
$$;

ALTER FUNCTION public.normalizar_cedula(text) OWNER TO postgres;
ALTER FUNCTION public.cedula_nicaraguense_valida(text) OWNER TO postgres;
ALTER FUNCTION public.cedula_fecha_nacimiento(text) OWNER TO postgres;
ALTER FUNCTION public.normalizar_telefono_ni(text) OWNER TO postgres;
ALTER FUNCTION public.normalizar_ruc(text) OWNER TO postgres;

-- Las usan restricciones y triggers; también authenticated (los
-- CHECK y triggers se evalúan con el rol de quien escribe).
REVOKE ALL ON FUNCTION public.normalizar_cedula(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cedula_nicaraguense_valida(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cedula_fecha_nacimiento(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.normalizar_telefono_ni(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.normalizar_ruc(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.normalizar_cedula(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cedula_nicaraguense_valida(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cedula_fecha_nacimiento(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_telefono_ni(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_ruc(text) TO authenticated;


-- ---------------------------------------------------------
-- 2. CLIENTES DE LA TIENDA
-- ---------------------------------------------------------

ALTER TABLE public.clientes_web
  ADD COLUMN IF NOT EXISTS cedula text;

CREATE OR REPLACE FUNCTION public.validar_identidad_cliente_web()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_nacimiento date;
BEGIN
  NEW.cedula := public.normalizar_cedula(NEW.cedula);
  NEW.telefono := public.normalizar_telefono_ni(NEW.telefono);

  -- El cliente puede agregar su cédula, pero no cambiarla.
  IF TG_OP = 'UPDATE'
     AND OLD.cedula IS NOT NULL
     AND NEW.cedula IS DISTINCT FROM OLD.cedula
     AND auth.uid() = OLD.id THEN
    RAISE EXCEPTION 'La cédula no se puede cambiar. Si hay un error, contactá a la tienda.';
  END IF;

  IF NEW.cedula IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.cedula IS DISTINCT FROM OLD.cedula) THEN
    IF NOT public.cedula_nicaraguense_valida(NEW.cedula) THEN
      RAISE EXCEPTION 'La cédula no es válida. Revisá los números y la letra final (ej. 001-010190-0000M).';
    END IF;

    v_nacimiento := public.cedula_fecha_nacimiento(NEW.cedula);

    IF v_nacimiento IS NULL
       OR v_nacimiento > ((now() AT TIME ZONE 'America/Managua')::date - INTERVAL '16 years') THEN
      RAISE EXCEPTION 'La fecha de nacimiento de la cédula no corresponde a una persona de 16 años o más.';
    END IF;
  END IF;

  IF NEW.telefono IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.telefono IS DISTINCT FROM OLD.telefono)
     AND NEW.telefono !~ '^[2578][0-9]{7}$' THEN
    RAISE EXCEPTION 'El teléfono debe ser un número de Nicaragua de 8 dígitos (ej. 8123 4567).';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.validar_identidad_cliente_web() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validar_identidad_cliente_web() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_clientes_web_identidad ON public.clientes_web;
CREATE TRIGGER trg_clientes_web_identidad
BEFORE INSERT OR UPDATE ON public.clientes_web
FOR EACH ROW
EXECUTE FUNCTION public.validar_identidad_cliente_web();

-- Respaldo de las mismas reglas (el trigger da el mensaje claro).
ALTER TABLE public.clientes_web DROP CONSTRAINT IF EXISTS clientes_web_cedula_check;
ALTER TABLE public.clientes_web
  ADD CONSTRAINT clientes_web_cedula_check
  CHECK (cedula IS NULL OR public.cedula_nicaraguense_valida(cedula));

ALTER TABLE public.clientes_web DROP CONSTRAINT IF EXISTS clientes_web_telefono_check;
ALTER TABLE public.clientes_web
  ADD CONSTRAINT clientes_web_telefono_check
  CHECK (telefono IS NULL OR telefono ~ '^[2578][0-9]{7}$');

CREATE UNIQUE INDEX IF NOT EXISTS clientes_web_cedula_unique
ON public.clientes_web (cedula)
WHERE cedula IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_web_telefono_unique
ON public.clientes_web (telefono)
WHERE telefono IS NOT NULL;

-- El cliente puede completar su cédula desde "Mi cuenta".
GRANT UPDATE (cedula) ON TABLE public.clientes_web TO authenticated;


-- ---------------------------------------------------------
-- 3. REGISTRO: cédula y teléfono obligatorios para clientes
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
  v_cedula text;
  v_telefono text;
BEGIN
  v_es_personal :=
    lower(coalesce(new.raw_app_meta_data ->> 'account_type', '')) = 'personal';

  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'Usuario'), '@', 1)
  );

  IF NOT v_es_personal THEN
    v_cedula := nullif(trim(coalesce(new.raw_user_meta_data ->> 'cedula', '')), '');
    v_telefono := nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

    IF v_cedula IS NULL OR v_telefono IS NULL THEN
      RAISE EXCEPTION 'Para crear la cuenta se necesitan la cédula y el teléfono.';
    END IF;

    -- validar_identidad_cliente_web() normaliza y valida al insertar.
    INSERT INTO public.clientes_web (
      id, nombre, correo, telefono, direccion, cedula, activo
    )
    VALUES (
      new.id,
      v_nombre,
      coalesce(new.email, ''),
      v_telefono,
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'address', '')), ''),
      v_cedula,
      true
    )
    ON CONFLICT (id) DO UPDATE SET
      nombre = excluded.nombre,
      correo = excluded.correo,
      telefono = excluded.telefono,
      direccion = excluded.direccion,
      cedula = excluded.cedula,
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
-- 4. PEDIDOS WEB: exigir cédula y teléfono, copiar la cédula
-- ---------------------------------------------------------

ALTER TABLE public.pedidos_en_linea
  ADD COLUMN IF NOT EXISTS cliente_cedula text;

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

  v_metodo_pago := nullif(lower(trim(coalesce(p_metodo_pago, ''))), '');

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
    'recibido'::text;
END;
$function$;


-- ---------------------------------------------------------
-- 5. CLIENTES INTERNOS Y PROVEEDORES
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validar_identificacion_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.identificacion := public.normalizar_ruc(NEW.identificacion);

  IF NEW.identificacion IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_cliente = 'juridica' THEN
    IF NEW.identificacion !~ '^J[0-9]{13}$' THEN
      RAISE EXCEPTION 'El RUC de una empresa debe ser la letra J seguida de 13 dígitos (ej. J0310000000000).';
    END IF;
  ELSIF NOT public.cedula_nicaraguense_valida(NEW.identificacion) THEN
    RAISE EXCEPTION 'La cédula no es válida. Revisá los números y la letra final (ej. 001-010190-0000M).';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_ruc_proveedor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.ruc := public.normalizar_ruc(NEW.ruc);

  IF NEW.ruc IS NOT NULL
     AND NEW.ruc !~ '^J[0-9]{13}$'
     AND NOT public.cedula_nicaraguense_valida(NEW.ruc) THEN
    RAISE EXCEPTION 'El RUC debe ser J seguida de 13 dígitos (empresa) o una cédula válida (persona natural).';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.validar_identificacion_cliente() OWNER TO postgres;
ALTER FUNCTION public.validar_ruc_proveedor() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validar_identificacion_cliente() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_ruc_proveedor() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_clientes_identificacion ON public.clientes;
CREATE TRIGGER trg_clientes_identificacion
BEFORE INSERT OR UPDATE OF identificacion, tipo_cliente ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public.validar_identificacion_cliente();

DROP TRIGGER IF EXISTS trg_proveedores_ruc ON public.proveedores;
CREATE TRIGGER trg_proveedores_ruc
BEFORE INSERT OR UPDATE OF ruc ON public.proveedores
FOR EACH ROW
EXECUTE FUNCTION public.validar_ruc_proveedor();

-- Normaliza los RUC que ya existen antes de exigir que no se repitan.
UPDATE public.proveedores
SET ruc = public.normalizar_ruc(ruc)
WHERE ruc IS DISTINCT FROM public.normalizar_ruc(ruc);

CREATE UNIQUE INDEX IF NOT EXISTS clientes_identificacion_unique
ON public.clientes (identificacion)
WHERE identificacion IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS proveedores_ruc_unique
ON public.proveedores (ruc)
WHERE ruc IS NOT NULL;

COMMIT;
