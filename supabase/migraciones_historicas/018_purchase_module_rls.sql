-- =========================================================
-- 018_purchase_module_rls.sql
-- RLS definitivo del Módulo Compras
--
-- Encargado de Compras:
--   - Gestiona productos, catálogos y proveedores
--   - Consulta compras
--
-- Responsable de Compras:
--   - Consulta productos y proveedores
--   - Consulta compras
--   - Consulta recepciones
--   - Gestiona devoluciones mediante RPC
--
-- Almacén:
--   - Consulta productos
--   - Consulta compras autorizadas/recibidas
--   - Gestiona recepción mediante RPC
--   - Consulta inventario y Kardex
--
-- Gerencia:
--   - Consulta / supervisión
--
-- Ventas:
--   - Conserva consulta de productos/catálogos/existencias
--
-- Administración:
--   - Conserva consulta de productos/catálogos/existencias
--     para no afectar otros módulos actuales.
-- =========================================================

BEGIN;

-- =========================================================
-- CATEGORÍAS
-- =========================================================

DROP POLICY IF EXISTS categorias_insert_administracion_almacen
ON public.categorias;

DROP POLICY IF EXISTS categorias_select_roles_autorizados
ON public.categorias;

DROP POLICY IF EXISTS categorias_update_administracion_almacen
ON public.categorias;

DROP POLICY IF EXISTS categorias_insert_encargado_compras
ON public.categorias;

DROP POLICY IF EXISTS categorias_select_operativos
ON public.categorias;

DROP POLICY IF EXISTS categorias_update_encargado_compras
ON public.categorias;

CREATE POLICY categorias_select_operativos
ON public.categorias
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY categorias_insert_encargado_compras
ON public.categorias
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY categorias_update_encargado_compras
ON public.categorias
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- MARCAS
-- =========================================================

DROP POLICY IF EXISTS marcas_insert_administracion_almacen
ON public.marcas;

DROP POLICY IF EXISTS marcas_select_roles_autorizados
ON public.marcas;

DROP POLICY IF EXISTS marcas_update_administracion_almacen
ON public.marcas;

DROP POLICY IF EXISTS marcas_insert_encargado_compras
ON public.marcas;

DROP POLICY IF EXISTS marcas_select_operativos
ON public.marcas;

DROP POLICY IF EXISTS marcas_update_encargado_compras
ON public.marcas;

CREATE POLICY marcas_select_operativos
ON public.marcas
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY marcas_insert_encargado_compras
ON public.marcas
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY marcas_update_encargado_compras
ON public.marcas
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- MODELOS
-- =========================================================

DROP POLICY IF EXISTS modelos_insert_administracion_almacen
ON public.modelos;

DROP POLICY IF EXISTS modelos_select_roles_autorizados
ON public.modelos;

DROP POLICY IF EXISTS modelos_update_administracion_almacen
ON public.modelos;

DROP POLICY IF EXISTS modelos_insert_encargado_compras
ON public.modelos;

DROP POLICY IF EXISTS modelos_select_operativos
ON public.modelos;

DROP POLICY IF EXISTS modelos_update_encargado_compras
ON public.modelos;

CREATE POLICY modelos_select_operativos
ON public.modelos
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY modelos_insert_encargado_compras
ON public.modelos
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY modelos_update_encargado_compras
ON public.modelos
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- COLORES
-- =========================================================

DROP POLICY IF EXISTS colores_insert_administracion_almacen
ON public.colores;

DROP POLICY IF EXISTS colores_select_roles_autorizados
ON public.colores;

DROP POLICY IF EXISTS colores_update_administracion_almacen
ON public.colores;

DROP POLICY IF EXISTS colores_insert_encargado_compras
ON public.colores;

DROP POLICY IF EXISTS colores_select_operativos
ON public.colores;

DROP POLICY IF EXISTS colores_update_encargado_compras
ON public.colores;

CREATE POLICY colores_select_operativos
ON public.colores
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY colores_insert_encargado_compras
ON public.colores
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY colores_update_encargado_compras
ON public.colores
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- MATERIALES
-- =========================================================

DROP POLICY IF EXISTS materiales_insert_administracion_almacen
ON public.materiales;

DROP POLICY IF EXISTS materiales_select_roles_autorizados
ON public.materiales;

DROP POLICY IF EXISTS materiales_update_administracion_almacen
ON public.materiales;

DROP POLICY IF EXISTS materiales_insert_encargado_compras
ON public.materiales;

DROP POLICY IF EXISTS materiales_select_operativos
ON public.materiales;

DROP POLICY IF EXISTS materiales_update_encargado_compras
ON public.materiales;

CREATE POLICY materiales_select_operativos
ON public.materiales
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY materiales_insert_encargado_compras
ON public.materiales
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY materiales_update_encargado_compras
ON public.materiales
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- UNIDADES DE MEDIDA
-- =========================================================

DROP POLICY IF EXISTS unidades_medida_insert_administracion_almacen
ON public.unidades_medida;

DROP POLICY IF EXISTS unidades_medida_select_roles_autorizados
ON public.unidades_medida;

DROP POLICY IF EXISTS unidades_medida_update_administracion_almacen
ON public.unidades_medida;

DROP POLICY IF EXISTS unidades_medida_insert_encargado_compras
ON public.unidades_medida;

DROP POLICY IF EXISTS unidades_medida_select_operativos
ON public.unidades_medida;

DROP POLICY IF EXISTS unidades_medida_update_encargado_compras
ON public.unidades_medida;

CREATE POLICY unidades_medida_select_operativos
ON public.unidades_medida
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY unidades_medida_insert_encargado_compras
ON public.unidades_medida
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY unidades_medida_update_encargado_compras
ON public.unidades_medida
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- PRODUCTOS
-- =========================================================

DROP POLICY IF EXISTS productos_insert_administracion_almacen
ON public.productos;

DROP POLICY IF EXISTS productos_select_roles_autorizados
ON public.productos;

DROP POLICY IF EXISTS productos_update_administracion_almacen
ON public.productos;

DROP POLICY IF EXISTS productos_insert_encargado_compras
ON public.productos;

DROP POLICY IF EXISTS productos_select_operativos
ON public.productos;

DROP POLICY IF EXISTS productos_update_encargado_compras
ON public.productos;

CREATE POLICY productos_select_operativos
ON public.productos
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY productos_insert_encargado_compras
ON public.productos
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY productos_update_encargado_compras
ON public.productos
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- PROVEEDORES
-- =========================================================

DROP POLICY IF EXISTS proveedores_insert
ON public.proveedores;

DROP POLICY IF EXISTS proveedores_select
ON public.proveedores;

DROP POLICY IF EXISTS proveedores_update
ON public.proveedores;

DROP POLICY IF EXISTS proveedores_insert_encargado_compras
ON public.proveedores;

DROP POLICY IF EXISTS proveedores_select_compras
ON public.proveedores;

DROP POLICY IF EXISTS proveedores_update_encargado_compras
ON public.proveedores;

CREATE POLICY proveedores_select_compras
ON public.proveedores
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

CREATE POLICY proveedores_insert_encargado_compras
ON public.proveedores
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);

CREATE POLICY proveedores_update_encargado_compras
ON public.proveedores
FOR UPDATE
TO authenticated
USING (
  public.current_role_code() = 'encargado_compras'
)
WITH CHECK (
  public.current_role_code() = 'encargado_compras'
);


-- =========================================================
-- COMPRAS
-- =========================================================

DROP POLICY IF EXISTS compras_select
ON public.compras;

DROP POLICY IF EXISTS compras_select_por_rol
ON public.compras;

CREATE POLICY compras_select_por_rol
ON public.compras
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'encargado_compras',
    'responsable_compras'
  )
  OR
  (
    public.current_role_code() = 'almacen'
    AND estado IN (
      'autorizada',
      'recibida'
    )
  )
);


-- =========================================================
-- DETALLE DE COMPRAS
-- =========================================================

DROP POLICY IF EXISTS detalle_compras_select
ON public.detalle_compras;

DROP POLICY IF EXISTS detalle_compras_select_por_rol
ON public.detalle_compras;

CREATE POLICY detalle_compras_select_por_rol
ON public.detalle_compras
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'encargado_compras',
    'responsable_compras'
  )
  OR
  (
    public.current_role_code() = 'almacen'
    AND EXISTS (
      SELECT 1
      FROM public.compras c
      WHERE c.id = detalle_compras.compra_id
        AND c.estado IN (
          'autorizada',
          'recibida'
        )
    )
  )
);


-- =========================================================
-- RECEPCIONES DE COMPRA
-- =========================================================

DROP POLICY IF EXISTS recepciones_compra_select
ON public.recepciones_compra;

DROP POLICY IF EXISTS recepciones_compra_select_compras
ON public.recepciones_compra;

CREATE POLICY recepciones_compra_select_compras
ON public.recepciones_compra
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'encargado_compras',
    'responsable_compras',
    'almacen'
  )
);


-- =========================================================
-- DETALLE DE RECEPCIONES
-- =========================================================

DROP POLICY IF EXISTS detalle_recepciones_compra_select
ON public.detalle_recepciones_compra;

DROP POLICY IF EXISTS detalle_recepciones_compra_select_compras
ON public.detalle_recepciones_compra;

CREATE POLICY detalle_recepciones_compra_select_compras
ON public.detalle_recepciones_compra
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'encargado_compras',
    'responsable_compras',
    'almacen'
  )
);


-- =========================================================
-- DEVOLUCIONES DE COMPRA
-- =========================================================

DROP POLICY IF EXISTS devoluciones_compra_select
ON public.devoluciones_compra;

DROP POLICY IF EXISTS devoluciones_compra_select_compras
ON public.devoluciones_compra;

CREATE POLICY devoluciones_compra_select_compras
ON public.devoluciones_compra
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'responsable_compras',
    'almacen'
  )
);


-- =========================================================
-- DETALLE DE DEVOLUCIONES
-- =========================================================

DROP POLICY IF EXISTS detalle_devoluciones_compra_select
ON public.detalle_devoluciones_compra;

DROP POLICY IF EXISTS detalle_devoluciones_compra_select_compras
ON public.detalle_devoluciones_compra;

CREATE POLICY detalle_devoluciones_compra_select_compras
ON public.detalle_devoluciones_compra
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'responsable_compras',
    'almacen'
  )
);


-- =========================================================
-- EXISTENCIAS
-- =========================================================

DROP POLICY IF EXISTS existencias_select_roles_autorizados
ON public.existencias;

DROP POLICY IF EXISTS existencias_select_operativos
ON public.existencias;

CREATE POLICY existencias_select_operativos
ON public.existencias
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'ventas',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);


-- =========================================================
-- MOVIMIENTOS / KARDEX
-- =========================================================

DROP POLICY IF EXISTS movimientos_select_roles_autorizados
ON public.movimientos_inventario;

DROP POLICY IF EXISTS movimientos_select_operativos
ON public.movimientos_inventario;

CREATE POLICY movimientos_select_operativos
ON public.movimientos_inventario
FOR SELECT
TO authenticated
USING (
  public.current_role_code() IN (
    'gerencia',
    'administracion',
    'almacen',
    'encargado_compras',
    'responsable_compras'
  )
);

COMMIT;