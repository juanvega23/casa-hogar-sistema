// Convierte las cifras de panorama_propietario() y analisis_propietario()
// en lo que el Propietario quiere saber: conclusiones en palabras simples.
// Los límites son los mismos de las Alertas: ±10 % en ventas y 20 % / 10 % de margen.

export type Estado = 'bien' | 'atento' | 'mal' | 'sin_datos'

export const ESTADOS: Record<Estado, { icono: string, texto: string }> = {
  bien: { icono: '✓', texto: 'Bien' },
  atento: { icono: '!', texto: 'Para vigilar' },
  mal: { icono: '✕', texto: 'Preocupa' },
  sin_datos: { icono: '–', texto: 'Sin datos' },
}

// Colores validados con el verificador de daltonismo y contraste.
export const COLORES = {
  uno: '#4f5fc4',
  dos: '#dba60a',
  tres: '#1f9ad6',
  apagado: '#9aa3b2',
}

export type Panorama = {
  generado_en: string
  hoy: string
  dia: number
  dias_mes: number
  ventas: {
    mes: number
    mes_anterior_mismos_dias: number
    mes_anterior_total: number
    operaciones: number
  }
  ganancia: {
    neto: number
    costo: number
    neto_anterior: number
    costo_anterior: number
  }
  cobros: {
    por_cobrar: number
    vencido: number
    vencido_30: number
  }
  inventario: {
    activos: number
    agotados: number
    bajos: number
    valor: number
    sin_movimiento: number
  }
  acumulado: { dia: number, actual: number | null, anterior: number | null }[]
}

export type Linea = { nombre: string, neto: number, costo: number }

export type Analisis = {
  generado_en: string
  desde: string
  hoy: string
  meses: { mes: string, ventas: number, operaciones: number, neto: number, costo: number }[]
  departamentos: Linea[]
  productos: Linea[]
  productos_activos: number
  horario: { dia: number, franja: string, total: number, operaciones: number }[]
  canales: { mostrador: number, orden_tienda: number, en_linea: number }
  pago: { contado: number, credito: number }
  clientes: { identificados: number, recurrentes: number, monto_identificado: number, monto_top5: number }
  dinero: {
    inventario: number
    sin_movimiento: number
    costo_vendido_90: number
    cobro_al_dia: number
    cobro_1_30: number
    cobro_31_60: number
    cobro_mas_60: number
  }
}

export type Senal = {
  pregunta: string
  estado: Estado
  respuesta: string
  detalle: string
}

export function dinero(valor: number) {
  const decimales = Number.isInteger(valor) || Math.abs(valor) >= 1000 ? 0 : 2

  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor)
}

export function porcentaje(parte: number, total: number) {
  return total > 0 ? Math.round((parte / total) * 100) : 0
}

export function margen(neto: number, costo: number) {
  return neto > 0 ? Math.round(((neto - costo) / neto) * 100) : null
}

// Recibe 'AAAA-MM' o 'AAAA-MM-DD' sin correrse por la zona horaria
export function nombreMes(fecha: string, corto = false) {
  const [anio, mes] = fecha.split('-').map(Number)

  return new Intl.DateTimeFormat('es-NI', { month: corto ? 'short' : 'long' })
    .format(new Date(anio, mes - 1, 1))
    .replace('.', '')
}

export function mesAnterior(fecha: string) {
  const [anio, mes] = fecha.split('-').map(Number)

  return nombreMes(`${mes === 1 ? anio - 1 : anio}-${mes === 1 ? 12 : mes - 1}`)
}

export function conMayuscula(texto: string) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function plural(cantidad: number, singular: string, varios: string) {
  return `${cantidad} ${cantidad === 1 ? singular : varios}`
}

export function leerSenales(p: Panorama): Senal[] {
  const anterior = mesAnterior(p.hoy)
  const senales: Senal[] = []

  // ¿Estoy vendiendo más?
  if (p.ventas.mes_anterior_mismos_dias > 0) {
    const cambio = Math.round(
      ((p.ventas.mes - p.ventas.mes_anterior_mismos_dias) / p.ventas.mes_anterior_mismos_dias) * 100,
    )

    senales.push({
      pregunta: '¿Estoy vendiendo más?',
      estado: cambio <= -10 ? 'mal' : 'bien',
      respuesta: cambio >= 10 ? `Sí, ${cambio} % más` : cambio <= -10 ? `No, ${Math.abs(cambio)} % menos` : 'Igual que antes',
      detalle: `${dinero(p.ventas.mes)} frente a ${dinero(p.ventas.mes_anterior_mismos_dias)} en los mismos días de ${anterior}.`,
    })
  } else {
    senales.push({
      pregunta: '¿Estoy vendiendo más?',
      estado: 'sin_datos',
      respuesta: 'Sin comparación',
      detalle: `No hubo ventas en los mismos días de ${anterior}.`,
    })
  }

  // ¿Estoy ganando dinero?
  const ganancia = margen(p.ganancia.neto, p.ganancia.costo)

  senales.push(
    ganancia === null
      ? {
          pregunta: '¿Estoy ganando dinero?',
          estado: 'sin_datos',
          respuesta: 'Sin ventas aún',
          detalle: 'Este mes todavía no hay ventas para calcularlo.',
        }
      : {
          pregunta: '¿Estoy ganando dinero?',
          estado: ganancia < 10 ? 'mal' : ganancia < 20 ? 'atento' : 'bien',
          respuesta: `${ganancia} % de margen`,
          detalle: `Ganancia bruta de ${dinero(p.ganancia.neto - p.ganancia.costo)} este mes.`,
        },
  )

  // ¿Me están pagando?
  senales.push(
    p.cobros.por_cobrar <= 0
      ? {
          pregunta: '¿Me están pagando?',
          estado: 'bien',
          respuesta: 'Nadie te debe',
          detalle: 'No hay ventas a crédito pendientes de cobro.',
        }
      : p.cobros.vencido <= 0
        ? {
            pregunta: '¿Me están pagando?',
            estado: 'bien',
            respuesta: 'Sí, al día',
            detalle: `${dinero(p.cobros.por_cobrar)} por cobrar, todavía sin vencer.`,
          }
        : {
            pregunta: '¿Me están pagando?',
            estado: p.cobros.vencido_30 > 0 ? 'mal' : 'atento',
            respuesta: `${dinero(p.cobros.vencido)} atrasados`,
            detalle: `${porcentaje(p.cobros.vencido, p.cobros.por_cobrar)} % de lo que te deben ya venció.`,
          },
  )

  // ¿Tengo lo que el cliente busca?
  const faltan = p.inventario.agotados + p.inventario.bajos
  const faltanPct = porcentaje(faltan, p.inventario.activos)

  senales.push({
    pregunta: '¿Tengo lo que el cliente busca?',
    estado: p.inventario.activos === 0 ? 'sin_datos' : faltanPct < 5 ? 'bien' : faltanPct < 15 ? 'atento' : 'mal',
    respuesta: p.inventario.activos === 0 ? 'Sin productos' : `${100 - faltanPct} % bien surtido`,
    detalle: `${faltan} de ${plural(p.inventario.activos, 'producto', 'productos')} ${faltan === 1 ? 'está agotado o por agotarse' : 'están agotados o por agotarse'}.`,
  })

  return senales
}

export function leerConclusion(p: Panorama, senales: Senal[]) {
  const mes = nombreMes(p.hoy)
  const anterior = mesAnterior(p.hoy)
  const frases: string[] = []

  // Con pocas ventas no se concluye nada: se dice tal cual
  const titulo = p.ventas.operaciones < POCAS_VENTAS
    ? `${conMayuscula(mes)} todavía tiene pocas ventas para concluir`
    : senales.some(s => s.estado === 'mal')
      ? `${conMayuscula(mes)} necesita tu atención`
      : senales.some(s => s.estado === 'atento')
        ? `${conMayuscula(mes)} va bien, con algo por vigilar`
        : `${conMayuscula(mes)} va bien`

  if (p.ventas.mes <= 0) {
    frases.push('Este mes todavía no hay ventas.')
  } else {
    frases.push(`Llevas ${dinero(p.ventas.mes)} vendidos en ${plural(p.dia, 'día', 'días')} de ${mes}.`)

    const ganancia = margen(p.ganancia.neto, p.ganancia.costo)

    if (ganancia !== null) {
      frases.push(`De cada C$100 que vendes te quedan C$${ganancia} antes de gastos.`)
    }

    const proyeccion = leerProyeccion(p)

    if (proyeccion !== null) {
      frases.push(
        `A este ritmo cerrarías el mes cerca de ${dinero(proyeccion)}${p.ventas.mes_anterior_total > 0 ? `, frente a ${dinero(p.ventas.mes_anterior_total)} de ${anterior}` : ''}.`,
      )
    }
  }

  return { titulo, frases }
}

// Con menos de 5 días transcurridos el ritmo todavía no dice nada
export function leerProyeccion(p: Panorama) {
  if (p.dia < 5 || p.ventas.mes <= 0) return null

  return Math.round(((p.ventas.mes / p.dia) * p.dias_mes) / 10) * 10
}

export const POCAS_VENTAS = 10

export type Cuadrante = {
  id: string
  titulo: string
  consejo: string
  productos: Linea[]
}

// Cruza cuánto vende cada producto con cuánto deja por córdoba vendido
export function clasificarProductos(productos: Linea[]): Cuadrante[] {
  const ordenados = [...productos].map(p => p.neto).sort((a, b) => a - b)
  const mitad = ordenados[Math.floor(ordenados.length / 2)] ?? 0
  const netoTotal = productos.reduce((suma, p) => suma + p.neto, 0)
  const costoTotal = productos.reduce((suma, p) => suma + p.costo, 0)
  const margenGeneral = netoTotal > 0 ? (netoTotal - costoTotal) / netoTotal : 0

  const grupos: Cuadrante[] = [
    { id: 'estrellas', titulo: 'Tus estrellas', consejo: 'Venden y dejan ganancia. Que nunca falten.', productos: [] },
    { id: 'volumen', titulo: 'Venden, pero dejan poco', consejo: 'Conviene revisar su costo o su precio.', productos: [] },
    { id: 'joyas', titulo: 'Dejan bien, venden poco', consejo: 'Podrían vender más si se dan a conocer.', productos: [] },
    { id: 'bajos', titulo: 'Aportan poco', consejo: 'Piensa si vale la pena seguir reponiéndolos.', productos: [] },
  ]

  for (const producto of productos) {
    const vende = producto.neto >= mitad
    const deja = producto.neto > 0 && (producto.neto - producto.costo) / producto.neto >= margenGeneral

    grupos[vende ? (deja ? 0 : 1) : deja ? 2 : 3].productos.push(producto)
  }

  return grupos
}

// Cuántos productos, de mayor a menor, juntan el 80 % de la ganancia
export function productosDelOchenta(productos: Linea[]) {
  const ganancias = productos.map(p => p.neto - p.costo).filter(g => g > 0).sort((a, b) => b - a)
  const total = ganancias.reduce((suma, g) => suma + g, 0)
  let acumulado = 0
  let cuantos = 0

  for (const ganancia of ganancias) {
    if (total <= 0 || acumulado >= total * 0.8) break
    acumulado += ganancia
    cuantos += 1
  }

  return cuantos
}

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const FRANJAS = [
  { id: 'manana', texto: 'Mañana', frase: 'por la mañana' },
  { id: 'tarde', texto: 'Tarde', frase: 'por la tarde' },
  { id: 'noche', texto: 'Noche', frase: 'por la noche' },
]

export function duracionInventario(valor: number, costoVendido90: number) {
  if (costoVendido90 <= 0) return null

  return Math.round(valor / (costoVendido90 / 90))
}

export function textoDuracion(dias: number) {
  if (dias > 730) return 'más de 2 años'
  if (dias > 60) return `unos ${Math.round(dias / 30)} meses`

  return dias === 1 ? '1 día' : `${dias} días`
}
