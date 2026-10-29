-- =========================================================
-- BAJA DEL ROL MARKETING DIGITAL
--
-- marketing_digital hacía lo mismo que el Vendedor en Pedidos en
-- línea (ver, confirmar, preparar, rechazar o cancelar) sin una
-- función propia. Atender pedidos es una operación de Ventas, así
-- que el rol se elimina y los pedidos quedan en Ventas: Vendedor
-- gestiona; Responsable Comercial y Gerencia consultan.
--
-- No borra trazabilidad: la auditoría no tiene registros del rol y
-- la cuenta de prueba marketing@casahogar.test no creó datos (solo
-- su perfil, que se elimina en cascada con la cuenta).
--
-- Afecta:
--   cambiar_estado_pedido_web(...)   (solo el rol vendedor)
--   10 políticas SELECT              (se quita marketing_digital;
--                                     los demás roles no cambian)
--   auth.users / profiles            (cuenta marketing@casahogar.test)
--   roles                            (fila marketing_digital)
-- Privilegios: sin cambios (CREATE OR REPLACE conserva los GRANT).
-- =========================================================

BEGIN;

-- ---------------------------------------------------------
-- 1. POLÍTICAS DE LECTURA
-- ---------------------------------------------------------

ALTER POLICY "categorias_select_operativos" ON public.categorias
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "colores_select_operativos" ON public.colores
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "marcas_select_operativos" ON public.marcas
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "materiales_select_operativos" ON public.materiales
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "modelos_select_operativos" ON public.modelos
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "unidades_medida_select_operativos" ON public.unidades_medida
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'ventas'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "existencias_select_operativos" ON public.existencias
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "productos_select_operativos" ON public.productos
  USING (public.current_role_code() = ANY (ARRAY['gerencia'::text, 'administracion'::text, 'vendedor'::text, 'responsable_comercial'::text, 'almacen'::text, 'encargado_compras'::text, 'responsable_compras'::text]));

ALTER POLICY "pedidos_en_linea_select_comercial" ON public.pedidos_en_linea
  USING (public.current_role_code() = ANY (ARRAY['vendedor'::text, 'responsable_comercial'::text, 'gerencia'::text]));

ALTER POLICY "detalle_pedidos_en_linea_select_comercial" ON public.detalle_pedidos_en_linea
  USING (public.current_role_code() = ANY (ARRAY['vendedor'::text, 'responsable_comercial'::text, 'gerencia'::text]));


-- ---------------------------------------------------------
-- 2. GESTIÓN DE PEDIDOS WEB: SOLO VENDEDOR
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cambiar_estado_pedido_web(p_pedido_id bigint, p_estado text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(pedido_id bigint, numero text, estado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    'vendedor'
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
$function$;


-- ---------------------------------------------------------
-- 3. CUENTA DE PRUEBA Y ROL
-- ---------------------------------------------------------

-- El perfil se elimina en cascada (profiles_id_fkey ON DELETE CASCADE).
DELETE FROM auth.users
WHERE id IN (
  SELECT p.id
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE r.codigo = 'marketing_digital'
);

DELETE FROM public.roles
WHERE codigo = 'marketing_digital';

COMMIT;
