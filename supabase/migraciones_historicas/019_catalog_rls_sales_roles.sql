-- =========================================================
-- 019 · CATÁLOGOS DE PRODUCTO VISIBLES PARA LOS ROLES DE VENTAS
--
-- Las políticas *_select_operativos de los catálogos solo
-- incluían el rol antiguo 'ventas'. Los roles actuales del
-- Módulo Ventas (vendedor, responsable_comercial,
-- marketing_digital) pueden consultar productos, pero la
-- categoría, marca, etc. llegaban vacías al hacer el join.
--
-- Se AGREGAN los roles nuevos. El rol 'ventas' se conserva
-- por compatibilidad hasta terminar la migración de usuarios.
-- =========================================================

BEGIN;

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY[
    'categorias',
    'marcas',
    'modelos',
    'colores',
    'materiales',
    'unidades_medida'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_tabla || '_select_operativos',
      v_tabla
    );

    EXECUTE format(
      $f$
      CREATE POLICY %I
      ON public.%I
      FOR SELECT
      TO authenticated
      USING (
        public.current_role_code() IN (
          'gerencia',
          'administracion',
          'ventas',
          'vendedor',
          'responsable_comercial',
          'marketing_digital',
          'almacen',
          'encargado_compras',
          'responsable_compras'
        )
      )
      $f$,
      v_tabla || '_select_operativos',
      v_tabla
    );
  END LOOP;
END;
$$;

COMMIT;
