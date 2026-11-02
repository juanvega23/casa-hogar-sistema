import { supabaseTienda } from './supabase'

// Orden en tienda: el cliente que está en la ferretería arma su carrito
// en el celular y recibe un código; el Vendedor lo carga en "Registrar
// venta" y Caja cobra como siempre. No aparta inventario ni fija precios.

export type OrdenTienda = {
  codigo: string
  total: number
  expira: string
  items: { nombre: string, cantidad: number }[]
}

const CLAVE_ORDEN = 'casa-hogar:orden-tienda'

export function leerOrdenGuardada(): OrdenTienda | null {
  try {
    const guardada = window.localStorage.getItem(CLAVE_ORDEN)
    if (!guardada) return null

    const orden = JSON.parse(guardada) as OrdenTienda
    return new Date(orden.expira).getTime() > Date.now() ? orden : null
  } catch {
    return null
  }
}

export function guardarOrden(orden: OrdenTienda | null) {
  try {
    if (orden) window.localStorage.setItem(CLAVE_ORDEN, JSON.stringify(orden))
    else window.localStorage.removeItem(CLAVE_ORDEN)
  } catch {
    // Sin almacenamiento: el código igual se muestra en pantalla
  }
}

export async function crearOrdenTienda(
  items: { producto_id: number, nombre: string, cantidad: number }[],
  nombre: string,
): Promise<{ orden: OrdenTienda | null, error: string }> {
  const { data, error } = await supabaseTienda.rpc('crear_orden_tienda', {
    p_items: items.map(item => ({ producto_id: item.producto_id, cantidad: item.cantidad })),
    p_nombre: nombre.trim() || null,
  })

  if (error) return { orden: null, error: error.message }

  const fila = (Array.isArray(data) ? data[0] : data) as { codigo: string, total_estimado: number, expira_at: string }

  return {
    orden: {
      codigo: fila.codigo,
      total: Number(fila.total_estimado),
      expira: fila.expira_at,
      items: items.map(item => ({ nombre: item.nombre, cantidad: item.cantidad })),
    },
    error: '',
  }
}

// "T7K 4Q9": en dos grupos se dicta y se lee más fácil
export function codigoLegible(codigo: string) {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`
}
