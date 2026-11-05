export type RoleCode =
  | 'propietario'
  | 'gerencia'
  | 'almacen'
  | 'soporte_ti'
  | 'encargado_compras'
  | 'responsable_compras'
  | 'vendedor'
  | 'responsable_comercial'
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
  // GERENCIA
  //
  // Supervisa la operación: Panel de supervisión con lo que
  // está pendiente en cada área, más consulta de los módulos.
  // No ejecuta operaciones ni administra el sistema.
  // =========================================================
  gerencia: [
    {
      id: 'supervision',
      nombre: 'Panel de supervisión',
    },

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
          nombre: 'Movimientos de inventario',
        },
        {
          id: 'kardex-consulta',
          nombre: 'Kárdex por producto',
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

    // ---------------------------------------------------------
    // SOPORTE TI
    // Solo consulta.
    // ---------------------------------------------------------
    {
      id: 'soporte-modulo',
      nombre: 'Soporte TI',
      children: [
        {
          id: 'soporte-panel-consulta',
          nombre: 'Panel de soporte',
        },
        {
          id: 'incidencias-consulta',
          nombre: 'Incidencias',
        },
        {
          id: 'equipos-ti-consulta',
          nombre: 'Equipos de TI',
        },
        {
          id: 'respaldos-consulta',
          nombre: 'Respaldos',
        },
      ],
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
      nombre: 'Productos y precios',
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
          id: 'caja-pagos-linea',
          nombre: 'Pagos en línea',
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
        {
          id: 'caja-cuentas',
          nombre: 'Cuentas bancarias',
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
  // Gestiona inventario, movimientos y kárdex por producto.
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
          id: 'despachos',
          nombre: 'Despachos',
        },
        {
          id: 'inventario',
          nombre: 'Bodega / Inventario',
        },
        {
          id: 'movimientos',
          nombre: 'Movimientos de inventario',
        },
        {
          id: 'kardex',
          nombre: 'Kárdex por producto',
        },
        {
          id: 'reposicion',
          nombre: 'Reposición',
        },
      ],
    },
  ],

  // =========================================================
  // SOPORTE TI
  // =========================================================
  soporte_ti: [
    {
      id: 'soporte-panel',
      nombre: 'Panel de soporte',
    },
    {
      id: 'incidencias',
      nombre: 'Incidencias',
    },
    {
      id: 'equipos-ti',
      nombre: 'Equipos de TI',
    },
    {
      id: 'respaldos',
      nombre: 'Respaldos',
    },
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