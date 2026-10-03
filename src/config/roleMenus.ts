export type RoleCode =
  | 'gerencia'
  | 'administracion'
  | 'ventas'
  | 'almacen'
  | 'soporte_ti'

export type MenuItem = {
  id: string
  nombre: string
}

export const menusByRole: Record<RoleCode, MenuItem[]> = {
  gerencia: [
    { id: 'dashboard', nombre: 'Dashboard' },
    { id: 'reportes', nombre: 'Reportes y análisis' },
    { id: 'inventario-consulta', nombre: 'Inventario' },
    { id: 'compras-consulta', nombre: 'Compras' },
    { id: 'proveedores-consulta', nombre: 'Proveedores' },
    { id: 'alertas', nombre: 'Alertas y recomendaciones' },
  ],

  administracion: [
    { id: 'dashboard', nombre: 'Dashboard' },
    { id: 'ventas', nombre: 'Ventas' },
    { id: 'caja', nombre: 'Caja' },
    { id: 'inventario', nombre: 'Inventario' },
    { id: 'compras', nombre: 'Compras' },
    { id: 'proveedores', nombre: 'Proveedores' },
    { id: 'reportes', nombre: 'Reportes' },
  ],

  ventas: [
    { id: 'ventas', nombre: 'Ventas' },
    { id: 'caja', nombre: 'Caja' },
    { id: 'productos-consulta', nombre: 'Consultar productos' },
  ],

  almacen: [
    { id: 'inventario', nombre: 'Inventario' },
    { id: 'productos', nombre: 'Productos' },
    { id: 'recepciones', nombre: 'Recepción de productos' },
    { id: 'movimientos', nombre: 'Movimientos' },
    { id: 'reposicion', nombre: 'Reposición' },
  ],

  soporte_ti: [
    { id: 'usuarios', nombre: 'Usuarios' },
    { id: 'roles', nombre: 'Roles y permisos' },
    { id: 'auditoria', nombre: 'Auditoría' },
    { id: 'configuracion', nombre: 'Configuración' },
  ],
}