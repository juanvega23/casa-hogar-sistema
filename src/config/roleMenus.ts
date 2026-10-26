export type RoleCode =
  | 'propietario'
  | 'gerencia'
  | 'administracion'
  | 'ventas' // TEMPORAL: rol antiguo mientras hacemos la migración
  | 'almacen'
  | 'soporte_ti'
  | 'encargado_compras'
  | 'responsable_compras'
  | 'vendedor'
  | 'responsable_comercial'
  | 'marketing_digital'
  | 'responsable_caja'

export type MenuItem = {
  id: string
  nombre: string
  children?: MenuItem[]
}

export const menusByRole: Record<
  RoleCode,
  MenuItem[]
> = {
  // =========================================================
  // PROPIETARIO
  //
  // Visión estratégica del negocio.
  // Solo consulta.
  // =========================================================
  propietario: [
    {
      id: 'dashboard',
      nombre: 'Dashboard',
    },
    {
      id: 'reportes-analisis',
      nombre: 'Reportes y análisis',
    },
    {
      id: 'alertas-recomendaciones',
      nombre: 'Alertas / recomendaciones',
    },
  ],

  // =========================================================
  // GERENCIA / ADMINISTRACIÓN
  //
  // Consulta, supervisión y análisis.
  // No ejecuta operaciones.
  // =========================================================
  gerencia: [
    // ---------------------------------------------------------
    // COMPRAS
    // ---------------------------------------------------------
    {
      id: 'compras-modulo',
      nombre: 'Compras',
      children: [
        {
          id: 'productos-consulta',
          nombre: 'Productos',
        },
        {
          id: 'proveedores-consulta',
          nombre: 'Proveedores',
        },
        {
          id: 'compras-consulta',
          nombre: 'Compras registradas',
        },
        {
          id: 'recepciones-consulta',
          nombre: 'Recepción de productos',
        },
        {
          id: 'inventario-consulta',
          nombre: 'Bodega / Inventario',
        },
        {
          id: 'movimientos-consulta',
          nombre: 'Movimientos / Kardex',
        },
        {
          id: 'devoluciones-consulta',
          nombre: 'Devoluciones de compra',
        },
      ],
    },

    // ---------------------------------------------------------
    // VENTAS
    // Solo consulta.
    // ---------------------------------------------------------
    {
      id: 'ventas-modulo',
      nombre: 'Ventas',
      children: [
        {
          id: 'clientes',
          nombre: 'Clientes',
        },
        {
          id: 'cotizaciones',
          nombre: 'Cotizaciones',
        },
        {
          id: 'ventas',
          nombre: 'Ventas',
        },
        {
          id: 'pedidos-en-linea',
          nombre: 'Pedidos en línea',
        },
        {
          id: 'cuentas-por-cobrar',
          nombre: 'Cuentas por cobrar',
        },
        {
          id: 'devoluciones-venta',
          nombre: 'Devoluciones de venta',
        },
        {
          id: 'historial-ventas',
          nombre: 'Historial de ventas',
        },
      ],
    },

    // ---------------------------------------------------------
    // CAJA
    // Solo consulta / supervisión.
    // ---------------------------------------------------------
    {
      id: 'caja-modulo',
      nombre: 'Caja',
      children: [
        {
          id: 'caja-historial',
          nombre: 'Historial de caja',
        },
      ],
    },

    {
      id: 'reportes',
      nombre: 'Reportes operativos',
    },

  ],

  // =========================================================
  // ADMINISTRACIÓN - ROL ANTIGUO / TEMPORAL
  //
  // Se conserva temporalmente mientras terminamos la migración.
  // La supervisión general se concentra en Gerencia.
  //
  // Solo se muestran pantallas que la base de datos le permite:
  // antes tenía Dashboard (exclusivo del Propietario), Ventas y
  // Caja, que fallaban por RLS. Puede registrar ajustes de
  // inventario (registrar_movimiento_inventario) y anular
  // compras (anular_compra).
  // =========================================================
  administracion: [
    {
      id: 'productos-consulta',
      nombre: 'Productos',
    },
    {
      id: 'inventario-consulta',
      nombre: 'Bodega / Inventario',
    },
    {
      id: 'movimientos',
      nombre: 'Movimientos / Ajustes',
    },
    {
      id: 'reportes',
      nombre: 'Reportes',
    },
  ],

  // =========================================================
  // VENTAS - ROL ANTIGUO
  //
  // TEMPORAL.
  // Se conserva hasta terminar la migración del usuario actual.
  // Luego será eliminado o desactivado.
  // =========================================================
  ventas: [
    {
      id: 'ventas',
      nombre: 'Ventas',
    },
    {
      id: 'caja',
      nombre: 'Caja',
    },
    {
      id: 'productos-consulta',
      nombre: 'Consultar productos',
    },
  ],

  // =========================================================
  // VENDEDOR / ASESOR DE VENTAS
  //
  // Actor operativo principal del Módulo Ventas.
  //
  // Puede:
  // - gestionar clientes
  // - elaborar cotizaciones
  // - registrar ventas
  // - gestionar pedidos
  // - registrar devoluciones
  // - consultar historial
  //
  // NO maneja Caja.
  // NO confirma devoluciones.
  // =========================================================
  vendedor: [
    {
      id: 'ventas-modulo',
      nombre: 'Ventas',
      children: [
        {
          id: 'clientes',
          nombre: 'Clientes',
        },
        {
          id: 'cotizaciones',
          nombre: 'Cotizaciones',
        },
        {
          id: 'ventas',
          nombre: 'Registrar venta',
        },
        {
          id: 'pedidos-en-linea',
          nombre: 'Pedidos en línea',
        },
        
        {
          id: 'devoluciones-venta',
          nombre: 'Devoluciones de venta',
        },
        {
          id: 'historial-ventas',
          nombre: 'Historial de ventas',
        },
      ],
    },

    {
      id: 'productos-consulta',
      nombre: 'Consultar productos',
    },
  ],

  // =========================================================
  // RESPONSABLE COMERCIAL Y ATENCIÓN AL CLIENTE
  //
  // Supervisa el Módulo Ventas.
  //
  // Puede:
  // - consultar clientes
  // - supervisar cotizaciones
  // - supervisar ventas
  // - supervisar pedidos
  // - consultar cuentas por cobrar
  // - confirmar o anular devoluciones
  // - consultar historial
  //
  // NO maneja Caja.
  // =========================================================
  responsable_comercial: [
    {
      id: 'ventas-modulo',
      nombre: 'Ventas',
      children: [
        {
          id: 'clientes',
          nombre: 'Clientes',
        },
        {
          id: 'cotizaciones',
          nombre: 'Cotizaciones',
        },
        {
          id: 'ventas',
          nombre: 'Ventas registradas',
        },
        {
          id: 'pedidos-en-linea',
          nombre: 'Pedidos en línea',
        },
        {
          id: 'cuentas-por-cobrar',
          nombre: 'Cuentas por cobrar',
        },
        {
          id: 'devoluciones-venta',
          nombre: 'Devoluciones de venta',
        },
        {
          id: 'historial-ventas',
          nombre: 'Historial de ventas',
        },
      ],
    },

    {
      id: 'productos-consulta',
      nombre: 'Consultar productos',
    },
  ],

  // =========================================================
  // MARKETING Y CANALES DIGITALES
  //
  // Participa solamente en funciones relacionadas con
  // el canal digital.
  //
  // NO registra ventas presenciales.
  // NO maneja Caja.
  // NO maneja devoluciones.
  // NO gestiona cuentas por cobrar.
  // =========================================================
  marketing_digital: [
    {
      id: 'ventas-modulo',
      nombre: 'Ventas',
      children: [
        {
          id: 'pedidos-en-linea',
          nombre: 'Pedidos en línea',
        },
      ],
    },

    {
      id: 'productos-consulta',
      nombre: 'Consultar productos',
    },
  ],

  // =========================================================
  // RESPONSABLE DE CAJA Y FACTURACIÓN
  //
  // Pertenece exclusivamente al Módulo Caja.
  //
  // Ventas genera la operación.
  // Caja registra el movimiento real del dinero.
  // =========================================================
  responsable_caja: [
    {
      id: 'caja-modulo',
      nombre: 'Caja',
      children: [
        {
          id: 'caja-apertura',
          nombre: 'Apertura de caja',
        },
        {
          id: 'caja-cobros',
          nombre: 'Cobros',
        },
        {
          id: 'caja-movimientos',
          nombre: 'Movimientos de caja',
        },
        {
          id: 'caja-arqueo',
          nombre: 'Arqueo de caja',
        },
        {
          id: 'caja-cierre',
          nombre: 'Cierre de caja',
        },
        {
          id: 'caja-devoluciones',
          nombre: 'Reembolsos de devoluciones',
        },
        {
          id: 'caja-historial',
          nombre: 'Historial de caja',
        },
      ],
    },
  ],

  // =========================================================
  // ENCARGADO DE COMPRAS
  //
  // Registra compras.
  // Gestiona productos.
  // Gestiona proveedores.
  // Puede consultar inventario.
  //
  // NO autoriza compras.
  // NO registra devoluciones.
  // =========================================================
  encargado_compras: [
    {
      id: 'compras-modulo',
      nombre: 'Compras',
      children: [
        {
          id: 'productos',
          nombre: 'Productos',
        },
        {
          id: 'proveedores',
          nombre: 'Proveedores',
        },
        {
          id: 'ordenes-compra',
          nombre: 'Compras',
        },
        {
          id: 'historial-compras',
          nombre: 'Historial de compras',
        },
        {
          id: 'inventario-consulta',
          nombre: 'Bodega / Inventario',
        },
      ],
    },
  ],

  // =========================================================
  // RESPONSABLE DE COMPRAS
  //
  // Revisa y autoriza compras.
  // Gestiona devoluciones.
  //
  // NO registra nuevas compras.
  // NO recibe físicamente mercancía.
  // =========================================================
  responsable_compras: [
    {
      id: 'compras-modulo',
      nombre: 'Compras',
      children: [
        {
          id: 'productos-consulta',
          nombre: 'Productos',
        },
        {
          id: 'autorizacion-compras',
          nombre: 'Autorización de compras',
        },
        {
          id: 'historial-compras',
          nombre: 'Historial de compras',
        },
        {
          id: 'devoluciones',
          nombre: 'Devoluciones de compra',
        },
        {
          id: 'inventario-consulta',
          nombre: 'Bodega / Inventario',
        },
      ],
    },
  ],

  // =========================================================
  // ALMACÉN / BODEGUERO
  //
  // Consulta productos.
  // Recibe productos.
  // Gestiona inventario y Kardex.
  //
  // NO registra compras.
  // NO autoriza compras.
  // NO origina devoluciones.
  // =========================================================
  almacen: [
    {
      id: 'compras-modulo',
      nombre: 'Compras',
      children: [
        {
          id: 'productos-consulta',
          nombre: 'Productos',
        },
        {
          id: 'recepciones',
          nombre: 'Recepción de productos',
        },
        {
          id: 'inventario',
          nombre: 'Bodega / Inventario',
        },
        {
          id: 'movimientos',
          nombre: 'Movimientos / Kardex',
        },
      ],
    },
  ],

  // =========================================================
  // SOPORTE TI
  // =========================================================
  soporte_ti: [
    {
      id: 'usuarios',
      nombre: 'Usuarios',
    },
    {
      id: 'roles',
      nombre: 'Roles y permisos',
    },
    {
      id: 'auditoria',
      nombre: 'Auditoría',
    },
    {
      id: 'configuracion',
      nombre: 'Configuración',
    },
  ],
}