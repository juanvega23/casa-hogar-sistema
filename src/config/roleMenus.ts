export type RoleCode =
  | 'gerencia'
  | 'administracion'
  | 'ventas'
  | 'almacen'
  | 'soporte_ti'
  | 'encargado_compras'
  | 'responsable_compras'

export type MenuItem = {
  id: string
  nombre: string
  children?: MenuItem[]
}

export const menusByRole: Record<RoleCode, MenuItem[]> = {
  // =========================================================
  // GERENCIA
  // Consulta, supervisión y análisis.
  // No ejecuta operaciones del proceso de compra.
  // =========================================================
  gerencia: [
    {
      id: 'dashboard',
      nombre: 'Dashboard',
    },

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

    {
      id: 'reportes',
      nombre: 'Reportes y análisis',
    },

    {
      id: 'alertas',
      nombre: 'Alertas y recomendaciones',
    },
  ],

  // =========================================================
  // ADMINISTRACIÓN
  // Ya no realiza operaciones propias del Módulo Compras.
  // =========================================================
  administracion: [
    {
      id: 'dashboard',
      nombre: 'Dashboard',
    },
    {
      id: 'ventas',
      nombre: 'Ventas',
    },
    {
      id: 'caja',
      nombre: 'Caja',
    },
    {
      id: 'reportes',
      nombre: 'Reportes',
    },
  ],

  // =========================================================
  // VENTAS
  // Conserva consulta de productos para realizar ventas.
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
  // ENCARGADO DE COMPRAS
  //
  // Registra compras.
  // Gestiona productos.
  // Gestiona proveedores.
  // Puede consultar recepción e inventario.
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
        id: 'compras',
        nombre: 'Compras',
      },
    ],
  },
],

  // =========================================================
  // RESPONSABLE DE COMPRAS
  //
  // Revisa y autoriza compras.
  // Gestiona devoluciones.
  // El resto es principalmente consulta.
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
          id: 'compras',
          nombre: 'Compras',
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
          id: 'devoluciones',
          nombre: 'Devoluciones de compra',
        },
      ],
    },
  ],

  // =========================================================
  // ALMACÉN / BODEGUERO
  //
  // Consulta productos.
  // Consulta compras autorizadas.
  // Recibe productos.
  // Gestiona inventario y Kardex.
  // Consulta devoluciones.
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