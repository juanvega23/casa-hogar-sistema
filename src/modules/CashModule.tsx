import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'

type CashModuleProps = {
  roleCode: string
  vista: string
}

type SesionCaja = {
  id: number
  numero: string
  abierta_por: string
  fecha_apertura: string
  monto_inicial: number
  estado: string
  fecha_cierre: string | null
  observaciones_apertura: string | null
  observaciones_cierre: string | null
}

type Venta = {
  id: number
  numero: string
  cliente_nombre: string | null
  total: number
  estado: string
  tipo_venta: string
  // Forma de pago que el cliente eligió en su pedido web (solo orienta).
  metodo_pago_preferido: string | null
}

type CuentaCobrar = {
  id: number
  venta_id: number
  fecha_vencimiento: string
  saldo_pendiente: number
  estado: string
  ventas:
    | {
        numero: string
        cliente_nombre: string | null
      }
    | {
        numero: string
        cliente_nombre: string | null
      }[]
    | null
}

type MovimientoCaja = {
  id: number
  sesion_caja_id: number | null
  venta_id: number | null
  tipo: string
  concepto: string
  metodo_pago: string | null
  monto: number
  referencia: string | null
  created_at: string
}

type ArqueoCaja = {
  id: number
  sesion_caja_id: number
  efectivo_esperado: number
  efectivo_contado: number
  diferencia: number
  // Conteo por denominación ("500.00": 2); null en arqueos anteriores
  detalle_efectivo: Record<string, number> | null
  tarjeta_esperado: number | null
  tarjeta_contado: number | null
  transferencia_esperado: number | null
  transferencia_contado: number | null
  observaciones: string | null
  created_at: string
}

type DevolucionCaja = {
  id: number
  numero: string
  venta_id: number
  motivo: string
  total: number
  estado_financiero: string
  monto_aplicado_cxc: number
  monto_reembolso: number
  confirmada_at: string | null
  ventas:
    | {
        numero: string
        cliente_nombre: string | null
        tipo_venta: string
      }
    | {
        numero: string
        cliente_nombre: string | null
        tipo_venta: string
      }[]
    | null
}

function etiquetaEstadoFinanciero(valor: string) {
  if (valor === 'pendiente') return 'Pendiente de procesar'
  if (valor === 'pendiente_reembolso') return 'Pendiente de reembolso'
  if (valor === 'aplicada_cxc') return 'Aplicada a crédito'
  if (valor === 'reembolsada') return 'Reembolsada'
  return valor
}

function relacion<T>(valor: T | T[] | null): T | null {
  if (!valor) return null
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function dinero(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

// Billetes y monedas del córdoba para el arqueo (C$10 existe en ambos)
const BILLETES = [1000, 500, 200, 100, 50, 20, 10]
const MONEDAS = [10, 5, 1, 0.5, 0.25, 0.1, 0.05]

const claveBillete = (valor: number) => `b${valor}`
const claveMoneda = (valor: number) => `m${valor}`

function cantidadConteo(texto: string | undefined) {
  const numero = Number(texto || 0)
  return Number.isInteger(numero) && numero > 0 ? numero : 0
}

// Diferencia de un arqueo en palabras: faltante, sobrante o cuadra
function estadoDiferencia(diferencia: number) {
  const redondeada = Math.round(diferencia * 100) / 100

  if (redondeada < 0) {
    return { texto: 'Faltante', clase: 'is-faltante' }
  }

  if (redondeada > 0) {
    return { texto: 'Sobrante', clase: 'is-sobrante' }
  }

  return { texto: 'Cuadra', clase: 'is-cuadra' }
}

function fecha(valor: string | null) {
  if (!valor) return '—'
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

function etiquetaMetodo(valor: string | null) {
  if (!valor) return '—'
  if (valor === 'efectivo') return 'Efectivo'
  if (valor === 'tarjeta') return 'Tarjeta'
  if (valor === 'transferencia') return 'Transferencia'
  return valor
}

export default function CashModule({
  roleCode,
  vista,
}: CashModuleProps) {
  const esCaja = roleCode === 'responsable_caja'
  const esGerencia = roleCode === 'gerencia'
  const puedeConsultar = esCaja || esGerencia

  const [sesiones, setSesiones] = useState<SesionCaja[]>([])
  const [sesionActual, setSesionActual] = useState<SesionCaja | null>(null)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [cuentas, setCuentas] = useState<CuentaCobrar[]>([])
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([])
  const [arqueos, setArqueos] = useState<ArqueoCaja[]>([])
  const [sesionHistorial, setSesionHistorial] = useState<SesionCaja | null>(null)

  const [montoInicial, setMontoInicial] = useState('')
  const [obsApertura, setObsApertura] = useState('')

  const [ventaId, setVentaId] = useState('')
  const [metodoCobro, setMetodoCobro] = useState('efectivo')
  const [montoRecibido, setMontoRecibido] = useState('')
  const [referenciaCobro, setReferenciaCobro] = useState('')

  // El formulario de abonos tiene su propio estado para no
  // mezclarse con el cobro de ventas de contado.
  const [cuentaId, setCuentaId] = useState('')
  const [montoAbono, setMontoAbono] = useState('')
  const [metodoAbono, setMetodoAbono] = useState('efectivo')
  const [recibidoAbono, setRecibidoAbono] = useState('')
  const [referenciaAbono, setReferenciaAbono] = useState('')

  const [devoluciones, setDevoluciones] = useState<DevolucionCaja[]>([])
  const [devolucionReembolso, setDevolucionReembolso] =
    useState<DevolucionCaja | null>(null)
  const [metodoReembolso, setMetodoReembolso] = useState('efectivo')
  const [referenciaReembolso, setReferenciaReembolso] = useState('')

  const [tipoMovimiento, setTipoMovimiento] = useState<'ingreso' | 'egreso'>('ingreso')
  const [conceptoMovimiento, setConceptoMovimiento] = useState('')
  const [metodoMovimiento, setMetodoMovimiento] = useState('efectivo')
  const [montoMovimiento, setMontoMovimiento] = useState('')
  const [referenciaMovimiento, setReferenciaMovimiento] = useState('')

  // Arqueo: cantidad por denominación (claves b1000, m10…) y otros medios
  const [conteo, setConteo] = useState<Record<string, string>>({})
  const [tarjetaContado, setTarjetaContado] = useState('')
  const [transferenciaContado, setTransferenciaContado] = useState('')
  const [obsArqueo, setObsArqueo] = useState('')
  const [obsCierre, setObsCierre] = useState('')

  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const arqueoActual = useMemo(
    () =>
      sesionActual
        ? arqueos.find(a => a.sesion_caja_id === sesionActual.id) ?? null
        : null,
    [arqueos, sesionActual],
  )

  const movimientosActuales = useMemo(
    () =>
      sesionActual
        ? movimientos.filter(m => m.sesion_caja_id === sesionActual.id)
        : [],
    [movimientos, sesionActual],
  )

  const ventaPreferida = ventas.find(v => v.id === Number(ventaId))

  const resumenActual = useMemo(() => {
    const ingresos = movimientosActuales
      .filter(m => m.tipo === 'ingreso')
      .reduce((a, b) => a + b.monto, 0)

    const egresos = movimientosActuales
      .filter(m => m.tipo === 'egreso')
      .reduce((a, b) => a + b.monto, 0)

    const ingresosEfectivo = movimientosActuales
      .filter(m => m.tipo === 'ingreso' && m.metodo_pago === 'efectivo')
      .reduce((a, b) => a + b.monto, 0)

    const egresosEfectivo = movimientosActuales
      .filter(m => m.tipo === 'egreso' && m.metodo_pago === 'efectivo')
      .reduce((a, b) => a + b.monto, 0)

    const esperadoEfectivo =
      (sesionActual?.monto_inicial ?? 0) +
      ingresosEfectivo -
      egresosEfectivo

    // Misma regla que registrar_arqueo_caja(): ingresos − egresos del método
    const netoMetodo = (metodo: string) =>
      Math.max(
        movimientosActuales
          .filter(m => m.metodo_pago === metodo)
          .reduce(
            (a, b) =>
              a +
              (b.tipo === 'ingreso' ? b.monto : b.tipo === 'egreso' ? -b.monto : 0),
            0,
          ),
        0,
      )

    return {
      ingresos,
      egresos,
      saldo:
        (sesionActual?.monto_inicial ?? 0) +
        ingresos -
        egresos,
      ingresosEfectivo,
      egresosEfectivo,
      esperadoEfectivo,
      esperadoTarjeta: netoMetodo('tarjeta'),
      esperadoTransferencia: netoMetodo('transferencia'),
    }
  }, [movimientosActuales, sesionActual])

  // Totales del conteo mientras la cajera escribe
  const totalBilletes = BILLETES.reduce(
    (a, valor) => a + valor * cantidadConteo(conteo[claveBillete(valor)]),
    0,
  )

  const totalMonedas = MONEDAS.reduce(
    (a, valor) => a + valor * cantidadConteo(conteo[claveMoneda(valor)]),
    0,
  )

  const totalContado =
    Math.round((totalBilletes + totalMonedas) * 100) / 100

  const diferenciaEfectivo =
    Math.round((totalContado - resumenActual.esperadoEfectivo) * 100) / 100

  const diferenciaTarjeta =
    Math.round((Number(tarjetaContado || 0) - resumenActual.esperadoTarjeta) * 100) / 100

  const diferenciaTransferencia =
    Math.round((Number(transferenciaContado || 0) - resumenActual.esperadoTransferencia) * 100) / 100

  const hayDiferencias =
    diferenciaEfectivo !== 0 ||
    diferenciaTarjeta !== 0 ||
    diferenciaTransferencia !== 0

  async function cargarDatos() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const [
      sesionesResp,
      movimientosResp,
      arqueosResp,
      ventasResp,
      cxcResp,
      devolucionesResp,
    ] = await Promise.all([
      supabase
        .from('sesiones_caja')
        .select(`
          id,
          numero,
          abierta_por,
          fecha_apertura,
          monto_inicial,
          estado,
          fecha_cierre,
          observaciones_apertura,
          observaciones_cierre
        `)
        .order('fecha_apertura', { ascending: false }),

      supabase
        .from('movimientos_caja')
        .select(`
          id,
          sesion_caja_id,
          venta_id,
          tipo,
          concepto,
          metodo_pago,
          monto,
          referencia,
          created_at
        `)
        .order('created_at', { ascending: false }),

      supabase
        .from('arqueos_caja')
        .select(`
          id,
          sesion_caja_id,
          efectivo_esperado,
          efectivo_contado,
          diferencia,
          detalle_efectivo,
          tarjeta_esperado,
          tarjeta_contado,
          transferencia_esperado,
          transferencia_contado,
          observaciones,
          created_at
        `)
        .order('created_at', { ascending: false }),

      esCaja
        ? supabase
            .from('ventas')
            .select(`
              id,
              numero,
              cliente_nombre,
              total,
              estado,
              tipo_venta,
              metodo_pago_preferido
            `)
            .eq('estado', 'pendiente_cobro')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),

      esCaja
        ? supabase
            .from('cuentas_por_cobrar')
            .select(`
              id,
              venta_id,
              fecha_vencimiento,
              saldo_pendiente,
              estado,
              ventas (
                numero,
                cliente_nombre
              )
            `)
            .gt('saldo_pendiente', 0)
            .order('fecha_vencimiento', { ascending: true })
        : Promise.resolve({ data: [], error: null }),

      esCaja && vista === 'caja-devoluciones'
        ? supabase
            .from('devoluciones_venta')
            .select(`
              id,
              numero,
              venta_id,
              motivo,
              total,
              estado_financiero,
              monto_aplicado_cxc,
              monto_reembolso,
              confirmada_at,
              ventas (
                numero,
                cliente_nombre,
                tipo_venta
              )
            `)
            .eq('estado', 'confirmada')
            .order('confirmada_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    const primeraError =
      sesionesResp.error ||
      movimientosResp.error ||
      arqueosResp.error ||
      ventasResp.error ||
      cxcResp.error ||
      devolucionesResp.error

    if (primeraError) {
      setError(primeraError.message)
      setCargando(false)
      return
    }

    const listaSesiones = (sesionesResp.data ?? []).map(item => ({
      ...item,
      id: Number(item.id),
      monto_inicial: Number(item.monto_inicial ?? 0),
    })) as SesionCaja[]

    setSesiones(listaSesiones)

    if (esCaja) {
      const { data: usuario } = await supabase.auth.getUser()
      const uid = usuario.user?.id

      setSesionActual(
        listaSesiones.find(
          s => s.estado === 'abierta' && (!uid || s.abierta_por === uid),
        ) ?? null,
      )
    } else {
      setSesionActual(null)
    }

    setMovimientos(
      (movimientosResp.data ?? []).map(item => ({
        ...item,
        id: Number(item.id),
        sesion_caja_id:
          item.sesion_caja_id === null ? null : Number(item.sesion_caja_id),
        venta_id:
          item.venta_id === null ? null : Number(item.venta_id),
        monto: Number(item.monto ?? 0),
      })) as MovimientoCaja[],
    )

    setArqueos(
      (arqueosResp.data ?? []).map(item => ({
        ...item,
        id: Number(item.id),
        sesion_caja_id: Number(item.sesion_caja_id),
        efectivo_esperado: Number(item.efectivo_esperado ?? 0),
        efectivo_contado: Number(item.efectivo_contado ?? 0),
        diferencia: Number(item.diferencia ?? 0),
      })) as ArqueoCaja[],
    )

    setVentas(
      (ventasResp.data ?? []).map(item => ({
        ...item,
        id: Number(item.id),
        total: Number(item.total ?? 0),
      })) as Venta[],
    )

    setCuentas(
      (cxcResp.data ?? []).map(item => ({
        ...item,
        id: Number(item.id),
        venta_id: Number(item.venta_id),
        saldo_pendiente: Number(item.saldo_pendiente ?? 0),
      })) as unknown as CuentaCobrar[],
    )

    setDevoluciones(
      (devolucionesResp.data ?? []).map(item => ({
        ...item,
        id: Number(item.id),
        venta_id: Number(item.venta_id),
        total: Number(item.total ?? 0),
        monto_aplicado_cxc: Number(item.monto_aplicado_cxc ?? 0),
        monto_reembolso: Number(item.monto_reembolso ?? 0),
      })) as unknown as DevolucionCaja[],
    )

    setCargando(false)
  }

  useEffect(() => {
    void cargarDatos()
  }, [roleCode, vista])

  function limpiarMensajes() {
    setError('')
    setExito('')
  }

  async function abrirCaja(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()
    setProcesando(true)

    const { data, error: rpcError } = await supabase.rpc('abrir_caja', {
      p_monto_inicial: Number(montoInicial || 0),
      p_observaciones: obsApertura.trim() || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    setExito(
      fila?.numero
        ? `Caja ${fila.numero} abierta correctamente.`
        : 'Caja abierta correctamente.',
    )
    setMontoInicial('')
    setObsApertura('')
    await cargarDatos()
    setProcesando(false)
  }

  async function cobrarVenta(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()

    if (!ventaId) {
      setError('Selecciona una venta pendiente de cobro.')
      return
    }

    const venta = ventas.find(v => v.id === Number(ventaId))
    if (!venta) return

    setProcesando(true)

    const recibido =
      metodoCobro === 'efectivo'
        ? Number(montoRecibido || venta.total)
        : venta.total

    const { data, error: rpcError } = await supabase.rpc('cobrar_venta', {
      p_venta_id: venta.id,
      p_metodo_pago: metodoCobro,
      p_monto_recibido: recibido,
      p_referencia: referenciaCobro.trim() || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    const cambio = Number(fila?.cambio ?? 0)

    setExito(
      cambio > 0
        ? `Venta ${venta.numero} cobrada correctamente. Cambio a entregar: ${dinero(cambio)}.`
        : `Venta ${venta.numero} cobrada correctamente.`,
    )
    setVentaId('')
    setMontoRecibido('')
    setReferenciaCobro('')
    setMetodoCobro('efectivo')
    await cargarDatos()
    setProcesando(false)
  }

  async function registrarAbono(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()

    const cuenta = cuentas.find(c => c.id === Number(cuentaId))
    const monto = Number(montoAbono)

    if (!cuenta) {
      setError('Selecciona una cuenta por cobrar.')
      return
    }

    if (!monto || monto <= 0 || monto > cuenta.saldo_pendiente) {
      setError('Indica un monto de abono válido.')
      return
    }

    setProcesando(true)

    const recibido =
      metodoAbono === 'efectivo'
        ? Number(recibidoAbono || monto)
        : monto

    const { data, error: rpcError } = await supabase.rpc('registrar_abono_venta', {
      p_venta_id: cuenta.venta_id,
      p_monto: monto,
      p_metodo_pago: metodoAbono,
      p_monto_recibido: recibido,
      p_referencia: referenciaAbono.trim() || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    const cambio = Number(fila?.cambio ?? 0)

    setExito(
      cambio > 0
        ? `Abono registrado correctamente. Cambio a entregar: ${dinero(cambio)}.`
        : 'Abono registrado correctamente.',
    )
    setCuentaId('')
    setMontoAbono('')
    setRecibidoAbono('')
    setReferenciaAbono('')
    await cargarDatos()
    setProcesando(false)
  }

  async function procesarDevolucion(devolucion: DevolucionCaja) {
    limpiarMensajes()
    setProcesando(true)

    const { data, error: rpcError } = await supabase.rpc(
      'aplicar_devolucion_financiera',
      { p_devolucion_id: devolucion.id },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    const aplicado = Number(fila?.monto_aplicado_cxc ?? 0)
    const reembolso = Number(fila?.monto_reembolso ?? 0)

    const partes = [`Devolución ${devolucion.numero} procesada.`]
    if (aplicado > 0) {
      partes.push(`${dinero(aplicado)} aplicados al saldo de crédito.`)
    }
    if (reembolso > 0) {
      partes.push(`${dinero(reembolso)} pendientes de reembolso al cliente.`)
    }

    setExito(partes.join(' '))
    await cargarDatos()
    setProcesando(false)
  }

  async function reembolsarDevolucion(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()

    if (!devolucionReembolso) return

    setProcesando(true)

    const { error: rpcError } = await supabase.rpc(
      'reembolsar_devolucion_venta',
      {
        p_devolucion_id: devolucionReembolso.id,
        p_metodo_pago: metodoReembolso,
        p_referencia: referenciaReembolso.trim() || null,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExito(
      `Reembolso de ${dinero(devolucionReembolso.monto_reembolso)} registrado para la devolución ${devolucionReembolso.numero}.`,
    )
    setDevolucionReembolso(null)
    setReferenciaReembolso('')
    await cargarDatos()
    setProcesando(false)
  }

  async function registrarMovimiento(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()

    setProcesando(true)

    const { error: rpcError } = await supabase.rpc(
      'registrar_movimiento_caja',
      {
        p_tipo: tipoMovimiento,
        p_concepto: conceptoMovimiento.trim(),
        p_metodo_pago: metodoMovimiento,
        p_monto: Number(montoMovimiento),
        p_referencia: referenciaMovimiento.trim() || null,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExito('Movimiento registrado correctamente.')
    setConceptoMovimiento('')
    setMontoMovimiento('')
    setReferenciaMovimiento('')
    await cargarDatos()
    setProcesando(false)
  }

  async function registrarArqueo(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()
    setProcesando(true)

    // La base recalcula el total a partir de este conteo.
    // C$10 en billete y en moneda se envían juntos.
    const pConteo: Record<string, number> = {}

    for (const [valores, clave] of [
      [BILLETES, claveBillete],
      [MONEDAS, claveMoneda],
    ] as const) {
      for (const valor of valores) {
        const cantidad = cantidadConteo(conteo[clave(valor)])

        if (cantidad > 0) {
          const denominacion = valor.toFixed(2)
          pConteo[denominacion] = (pConteo[denominacion] ?? 0) + cantidad
        }
      }
    }

    const { error: rpcError } = await supabase.rpc(
      'registrar_arqueo_caja',
      {
        p_conteo: pConteo,
        p_tarjeta_contado: Number(tarjetaContado || 0),
        p_transferencia_contado: Number(transferenciaContado || 0),
        p_observaciones: obsArqueo.trim() || null,
      },
    )

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    setExito('Arqueo registrado correctamente.')
    setConteo({})
    setTarjetaContado('')
    setTransferenciaContado('')
    setObsArqueo('')
    await cargarDatos()
    setProcesando(false)
  }

  async function cerrarCaja(event: FormEvent) {
    event.preventDefault()
    limpiarMensajes()
    setProcesando(true)

    const { data, error: rpcError } = await supabase.rpc('cerrar_caja', {
      p_observaciones: obsCierre.trim() || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    setExito(
      fila?.numero
        ? `Caja ${fila.numero} cerrada correctamente.`
        : 'Caja cerrada correctamente.',
    )
    setObsCierre('')
    await cargarDatos()
    setProcesando(false)
  }

  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso al módulo Caja.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando módulo Caja...</span>
      </div>
    )
  }

  const cabecera = (
    <section className="cash-status-card">
      <div>
        <span className="panel-label">MÓDULO CAJA</span>
        <h2>
          {sesionActual
            ? `Sesión ${sesionActual.numero}`
            : esGerencia
              ? 'Supervisión de caja'
              : 'Sin caja abierta'}
        </h2>
        <p>
          {sesionActual
            ? `Abierta ${fecha(sesionActual.fecha_apertura)} · Fondo inicial ${dinero(sesionActual.monto_inicial)}`
            : esGerencia
              ? 'Consulta las jornadas y movimientos registrados.'
              : 'Debes abrir una caja para comenzar las operaciones de la jornada.'}
        </p>
      </div>

      {sesionActual && (
        <span className="cash-open-badge">CAJA ABIERTA</span>
      )}
    </section>
  )

  const mensajes = (
    <>
      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}
    </>
  )

  if (vista === 'caja-apertura' || vista === 'caja') {
    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        <section className="cash-card">
          <span className="panel-label">APERTURA</span>
          <h3>Apertura de caja</h3>
          <p className="cash-help">
            Registra el fondo inicial con el que comienza la jornada.
          </p>

          {sesionActual ? (
            <div className="cash-info-box">
              Ya existe una sesión abierta: <strong>{sesionActual.numero}</strong>.
            </div>
          ) : (
            <form className="cash-form" onSubmit={abrirCaja}>
              <label>
                Monto inicial
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoInicial}
                  onChange={e => setMontoInicial(e.target.value)}
                  placeholder="0.00"
                />
              </label>

              <label className="cash-field-full">
                Observaciones
                <textarea
                  value={obsApertura}
                  onChange={e => setObsApertura(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="cash-actions cash-field-full">
                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={procesando || !esCaja}
                >
                  {procesando ? 'Abriendo...' : 'Abrir caja'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    )
  }

  if (vista === 'caja-cobros') {
    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        {!sesionActual && (
          <div className="cash-info-box">
            Debes abrir la caja antes de registrar cobros.
          </div>
        )}

        <div className="cash-two-columns">
          <section className="cash-card">
            <span className="panel-label">VENTAS</span>
            <h3>Cobro de ventas</h3>
            <p className="cash-help">
              Ventas de contado pendientes de cobro.
            </p>

            <form className="cash-form" onSubmit={cobrarVenta}>
              <label className="cash-field-full">
                Venta pendiente
                <select
                  value={ventaId}
                  onChange={e => {
                    setVentaId(e.target.value)
                    const venta = ventas.find(v => v.id === Number(e.target.value))
                    setMontoRecibido(venta ? String(venta.total) : '')
                    setMetodoCobro(venta?.metodo_pago_preferido ?? 'efectivo')
                  }}
                >
                  <option value="">Seleccionar venta</option>
                  {ventas.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.numero} · {v.cliente_nombre ?? 'Cliente general'} · {dinero(v.total)}
                    </option>
                  ))}
                </select>
              </label>

              {ventaPreferida?.metodo_pago_preferido && (
                <div className="cash-info-box cash-field-full">
                  El cliente eligió{' '}
                  <strong>{etiquetaMetodo(ventaPreferida.metodo_pago_preferido)}</strong>{' '}
                  en la tienda en línea. Puedes cambiarlo si paga de otra forma.
                </div>
              )}

              <label>
                Método de pago
                <select
                  value={metodoCobro}
                  onChange={e => setMetodoCobro(e.target.value)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>

              <label>
                Monto recibido
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoRecibido}
                  onChange={e => setMontoRecibido(e.target.value)}
                  disabled={metodoCobro !== 'efectivo'}
                />
              </label>

              <label className="cash-field-full">
                Referencia
                <input
                  value={referenciaCobro}
                  onChange={e => setReferenciaCobro(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="cash-actions cash-field-full">
                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={procesando || !sesionActual || !esCaja}
                >
                  Registrar cobro
                </button>
              </div>
            </form>
          </section>

          <section className="cash-card">
            <span className="panel-label">CRÉDITO</span>
            <h3>Abonos a cuentas por cobrar</h3>
            <p className="cash-help">
              Registra pagos parciales o totales de ventas a crédito.
            </p>

            <form className="cash-form" onSubmit={registrarAbono}>
              <label className="cash-field-full">
                Cuenta pendiente
                <select
                  value={cuentaId}
                  onChange={e => {
                    setCuentaId(e.target.value)
                    const cuenta = cuentas.find(c => c.id === Number(e.target.value))
                    setMontoAbono(cuenta ? String(cuenta.saldo_pendiente) : '')
                    setRecibidoAbono(cuenta ? String(cuenta.saldo_pendiente) : '')
                  }}
                >
                  <option value="">Seleccionar cuenta</option>
                  {cuentas.map(c => {
                    const venta = relacion(c.ventas)
                    return (
                      <option key={c.id} value={c.id}>
                        {venta?.numero ?? `Venta ${c.venta_id}`} · {venta?.cliente_nombre ?? 'Cliente'} · saldo {dinero(c.saldo_pendiente)}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label>
                Monto del abono
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={montoAbono}
                  onChange={e => {
                    setMontoAbono(e.target.value)
                    if (metodoAbono === 'efectivo') {
                      setRecibidoAbono(e.target.value)
                    }
                  }}
                />
              </label>

              <label>
                Método de pago
                <select
                  value={metodoAbono}
                  onChange={e => setMetodoAbono(e.target.value)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>

              <label>
                Monto recibido
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={recibidoAbono}
                  onChange={e => setRecibidoAbono(e.target.value)}
                  disabled={metodoAbono !== 'efectivo'}
                />
              </label>

              <label>
                Referencia
                <input
                  value={referenciaAbono}
                  onChange={e => setReferenciaAbono(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="cash-actions cash-field-full">
                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={procesando || !sesionActual || !esCaja}
                >
                  Registrar abono
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    )
  }

  if (vista === 'caja-movimientos') {
    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        {esCaja && (
          <section className="cash-card">
            <span className="panel-label">NUEVO MOVIMIENTO</span>
            <h3>Otros ingresos y egresos</h3>

            <form className="cash-form cash-form-3" onSubmit={registrarMovimiento}>
              <label>
                Tipo
                <select
                  value={tipoMovimiento}
                  onChange={e =>
                    setTipoMovimiento(e.target.value as 'ingreso' | 'egreso')
                  }
                >
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                </select>
              </label>

              <label>
                Concepto
                <input
                  value={conceptoMovimiento}
                  onChange={e => setConceptoMovimiento(e.target.value)}
                  placeholder="Concepto del movimiento"
                />
              </label>

              <label>
                Método
                <select
                  value={metodoMovimiento}
                  onChange={e => setMetodoMovimiento(e.target.value)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>

              <label>
                Monto
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={montoMovimiento}
                  onChange={e => setMontoMovimiento(e.target.value)}
                />
              </label>

              <label>
                Referencia
                <input
                  value={referenciaMovimiento}
                  onChange={e => setReferenciaMovimiento(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="cash-actions">
                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={procesando || !sesionActual}
                >
                  Registrar movimiento
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="cash-card">
          <div className="cash-section-head">
            <div>
              <span className="panel-label">JORNADA ACTUAL</span>
              <h3>Movimientos de caja</h3>
            </div>
            <strong>{movimientosActuales.length} movimientos</strong>
          </div>

          <div className="cash-summary-grid">
            <div><span>INGRESOS</span><strong>{dinero(resumenActual.ingresos)}</strong></div>
            <div><span>EGRESOS</span><strong>{dinero(resumenActual.egresos)}</strong></div>
            <div><span>SALDO</span><strong>{dinero(resumenActual.saldo)}</strong></div>
          </div>

          <div className="cash-table-wrap">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Método</th>
                  <th>Referencia</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {movimientosActuales.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="inventory-empty">
                      No hay movimientos en la jornada actual.
                    </td>
                  </tr>
                ) : (
                  movimientosActuales.map(m => (
                    <tr key={m.id}>
                      <td>{fecha(m.created_at)}</td>
                      <td>
                        <span className={`cash-type cash-type--${m.tipo}`}>
                          {m.tipo}
                        </span>
                      </td>
                      <td>{m.concepto}</td>
                      <td>{etiquetaMetodo(m.metodo_pago)}</td>
                      <td>{m.referencia ?? '—'}</td>
                      <td><strong>{dinero(m.monto)}</strong></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  if (vista === 'caja-arqueo') {
    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        <section className="cash-card">
          <span className="panel-label">ARQUEO</span>
          <h3>Arqueo de caja</h3>
          <p className="cash-help">
            {arqueoActual
              ? `Arqueo registrado el ${fecha(arqueoActual.created_at)}.`
              : 'Cuenta los billetes y monedas de la caja y anota los vouchers y transferencias. El sistema suma y compara con lo cobrado.'}
          </p>

          {arqueoActual ? (
            <div className="arqueo">
              {arqueoActual.detalle_efectivo && (
                <div className="arqueo-grupo">
                  <h4>Efectivo contado</h4>
                  <table className="arqueo-tabla">
                    <thead>
                      <tr>
                        <th>Cantidad</th>
                        <th>Denominación</th>
                        <th>Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(arqueoActual.detalle_efectivo)
                        .sort(([a], [b]) => Number(b) - Number(a))
                        .map(([denominacion, cantidad]) => (
                          <tr key={denominacion}>
                            <td>{cantidad}</td>
                            <td>{dinero(Number(denominacion))}</td>
                            <td>{dinero(Number(denominacion) * cantidad)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              <aside className="arqueo-resumen">
                <table className="arqueo-comparacion">
                  <thead>
                    <tr>
                      <th>Medio</th>
                      <th>Sistema</th>
                      <th>Contado</th>
                      <th>Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Efectivo', arqueoActual.efectivo_esperado, arqueoActual.efectivo_contado],
                      ['Tarjeta', arqueoActual.tarjeta_esperado, arqueoActual.tarjeta_contado],
                      ['Transferencia', arqueoActual.transferencia_esperado, arqueoActual.transferencia_contado],
                    ]
                      .filter(([, esperado, contado]) => esperado !== null && contado !== null)
                      .map(([medio, esperado, contado]) => {
                        const diferencia = Number(contado) - Number(esperado)
                        const estado = estadoDiferencia(diferencia)

                        return (
                          <tr key={String(medio)}>
                            <td>{medio}</td>
                            <td>{dinero(Number(esperado))}</td>
                            <td>{dinero(Number(contado))}</td>
                            <td>
                              <span className={`arqueo-estado ${estado.clase}`}>
                                {estado.texto}
                                {diferencia !== 0 && ` ${dinero(Math.abs(diferencia))}`}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>

                {arqueoActual.observaciones && (
                  <p className="arqueo-nota">
                    <strong>Observaciones:</strong> {arqueoActual.observaciones}
                  </p>
                )}
              </aside>
            </div>
          ) : (
            <form className="arqueo" onSubmit={registrarArqueo}>
              <div className="arqueo-conteo">
                {(
                  [
                    ['Billetes', BILLETES, claveBillete, totalBilletes],
                    ['Monedas', MONEDAS, claveMoneda, totalMonedas],
                  ] as const
                ).map(([titulo, valores, clave, total]) => (
                  <div key={titulo} className="arqueo-grupo">
                    <h4>{titulo}</h4>
                    <table className="arqueo-tabla">
                      <thead>
                        <tr>
                          <th>Cantidad</th>
                          <th>Denominación</th>
                          <th>Importe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valores.map(valor => {
                          const llave = clave(valor)

                          return (
                            <tr key={llave}>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  value={conteo[llave] ?? ''}
                                  onChange={e =>
                                    setConteo(actual => ({
                                      ...actual,
                                      [llave]: e.target.value,
                                    }))
                                  }
                                  placeholder="0"
                                  aria-label={`Cantidad de ${titulo.toLowerCase()} de ${dinero(valor)}`}
                                />
                              </td>
                              <td>{dinero(valor)}</td>
                              <td>{dinero(valor * cantidadConteo(conteo[llave]))}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Total {titulo.toLowerCase()}</td>
                          <td>{dinero(total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))}

                <div className="arqueo-grupo">
                  <h4>Otros medios</h4>
                  <label className="arqueo-medio">
                    <span>Vouchers de tarjeta</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tarjetaContado}
                      onChange={e => setTarjetaContado(e.target.value)}
                      placeholder="0.00"
                    />
                    <small>Sistema: {dinero(resumenActual.esperadoTarjeta)}</small>
                  </label>

                  <label className="arqueo-medio">
                    <span>Transferencias recibidas</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={transferenciaContado}
                      onChange={e => setTransferenciaContado(e.target.value)}
                      placeholder="0.00"
                    />
                    <small>Sistema: {dinero(resumenActual.esperadoTransferencia)}</small>
                  </label>
                </div>
              </div>

              <aside className="arqueo-resumen">
                <dl className="arqueo-cuentas">
                  <div><dt>Fondo inicial</dt><dd>{dinero(sesionActual?.monto_inicial ?? 0)}</dd></div>
                  <div><dt>+ Cobros en efectivo</dt><dd>{dinero(resumenActual.ingresosEfectivo)}</dd></div>
                  <div><dt>− Salidas en efectivo</dt><dd>{dinero(resumenActual.egresosEfectivo)}</dd></div>
                  <div className="is-total"><dt>Efectivo esperado</dt><dd>{dinero(resumenActual.esperadoEfectivo)}</dd></div>
                  <div className="is-total"><dt>Total contado</dt><dd>{dinero(totalContado)}</dd></div>
                </dl>

                {(
                  [
                    ['Efectivo', diferenciaEfectivo],
                    ['Tarjeta', diferenciaTarjeta],
                    ['Transferencia', diferenciaTransferencia],
                  ] as const
                ).map(([medio, diferencia]) => {
                  const estado = estadoDiferencia(diferencia)

                  return (
                    <div key={medio} className="arqueo-diferencia">
                      <span>{medio}</span>
                      <span className={`arqueo-estado ${estado.clase}`}>
                        {estado.texto}
                        {diferencia !== 0 && ` ${dinero(Math.abs(diferencia))}`}
                      </span>
                    </div>
                  )
                })}

                <label className="arqueo-observaciones">
                  <span>
                    Observaciones
                    {hayDiferencias && <em> · obligatorias si hay diferencias</em>}
                  </span>
                  <textarea
                    value={obsArqueo}
                    onChange={e => setObsArqueo(e.target.value)}
                    placeholder={hayDiferencias ? 'Explica el motivo de la diferencia' : 'Opcional'}
                    required={hayDiferencias}
                  />
                </label>

                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={
                    procesando ||
                    !sesionActual ||
                    !esCaja ||
                    (hayDiferencias && !obsArqueo.trim())
                  }
                >
                  Registrar arqueo
                </button>
              </aside>
            </form>
          )}
        </section>
      </div>
    )
  }

  if (vista === 'caja-cierre') {
    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        <section className="cash-card">
          <span className="panel-label">CIERRE</span>
          <h3>Cierre de caja</h3>

          <div className="cash-summary-grid cash-summary-grid--4">
            <div><span>INGRESOS</span><strong>{dinero(resumenActual.ingresos)}</strong></div>
            <div><span>EGRESOS</span><strong>{dinero(resumenActual.egresos)}</strong></div>
            <div><span>SALDO JORNADA</span><strong>{dinero(resumenActual.saldo)}</strong></div>
            <div>
              <span>DIFERENCIA</span>
              <strong>{arqueoActual ? dinero(arqueoActual.diferencia) : 'Sin arqueo'}</strong>
            </div>
          </div>

          {!arqueoActual && (
            <div className="cash-info-box">
              Debes realizar el arqueo antes de cerrar la caja.
            </div>
          )}

          <form className="cash-form" onSubmit={cerrarCaja}>
            <label className="cash-field-full">
              Observaciones de cierre
              <textarea
                value={obsCierre}
                onChange={e => setObsCierre(e.target.value)}
                placeholder="Opcional"
              />
            </label>

            <div className="cash-actions cash-field-full">
              <button
                className="product-primary-button"
                type="submit"
                disabled={procesando || !sesionActual || !arqueoActual || !esCaja}
              >
                {procesando ? 'Cerrando...' : 'Cerrar caja'}
              </button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  if (vista === 'caja-devoluciones') {
    const porProcesar = devoluciones.filter(
      d => d.estado_financiero === 'pendiente',
    )
    const porReembolsar = devoluciones.filter(
      d => d.estado_financiero === 'pendiente_reembolso',
    )

    return (
      <div className="cash-module">
        {cabecera}
        {mensajes}

        <div className="cash-summary-grid">
          <div>
            <span>POR PROCESAR</span>
            <strong>{porProcesar.length}</strong>
          </div>
          <div>
            <span>POR REEMBOLSAR</span>
            <strong>
              {dinero(porReembolsar.reduce((a, d) => a + d.monto_reembolso, 0))}
            </strong>
          </div>
          <div>
            <span>CONFIRMADAS</span>
            <strong>{devoluciones.length}</strong>
          </div>
        </div>

        {devolucionReembolso && (
          <section className="cash-card">
            <div className="cash-section-head">
              <div>
                <span className="panel-label">REEMBOLSO</span>
                <h3>
                  {devolucionReembolso.numero} · {dinero(devolucionReembolso.monto_reembolso)}
                </h3>
              </div>
              <button
                className="product-close-button"
                type="button"
                onClick={() => setDevolucionReembolso(null)}
              >
                ×
              </button>
            </div>

            {!sesionActual && (
              <div className="cash-info-box">
                Debes abrir la caja antes de registrar reembolsos.
              </div>
            )}

            <form className="cash-form" onSubmit={reembolsarDevolucion}>
              <label>
                Método de reembolso
                <select
                  value={metodoReembolso}
                  onChange={e => setMetodoReembolso(e.target.value)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </select>
              </label>

              <label>
                Referencia
                <input
                  value={referenciaReembolso}
                  onChange={e => setReferenciaReembolso(e.target.value)}
                  placeholder="Opcional"
                />
              </label>

              <div className="cash-actions cash-field-full">
                <button
                  className="product-primary-button"
                  type="submit"
                  disabled={procesando || !sesionActual || !esCaja}
                >
                  {procesando ? 'Registrando...' : 'Registrar reembolso'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="cash-card">
          <div className="cash-section-head">
            <div>
              <span className="panel-label">DEVOLUCIONES DE VENTA</span>
              <h3>Efecto financiero de devoluciones confirmadas</h3>
            </div>
            <span className="sales-result-count">
              {devoluciones.length} devoluciones
            </span>
          </div>

          <p className="cash-help">
            Procesar aplica primero el monto al saldo de crédito de la venta (si existe);
            lo restante queda pendiente de reembolso y sale de la caja abierta.
          </p>

          <div className="cash-table-wrap">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>Devolución</th>
                  <th>Venta</th>
                  <th>Total</th>
                  <th>A crédito</th>
                  <th>Reembolso</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {devoluciones.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="inventory-empty">
                      No hay devoluciones confirmadas.
                    </td>
                  </tr>
                ) : (
                  devoluciones.map(d => {
                    const venta = relacion(d.ventas)

                    return (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.numero}</strong>
                          <br />
                          <small>{d.motivo}</small>
                        </td>
                        <td>
                          {venta?.numero ?? `Venta ${d.venta_id}`}
                          <br />
                          <small>
                            {venta?.cliente_nombre ?? 'Cliente general'} ·{' '}
                            {venta?.tipo_venta === 'credito' ? 'Crédito' : 'Contado'}
                          </small>
                        </td>
                        <td>{dinero(d.total)}</td>
                        <td>{dinero(d.monto_aplicado_cxc)}</td>
                        <td><strong>{dinero(d.monto_reembolso)}</strong></td>
                        <td>{etiquetaEstadoFinanciero(d.estado_financiero)}</td>
                        <td>
                          {d.estado_financiero === 'pendiente' && (
                            <button
                              type="button"
                              className="product-edit-button"
                              disabled={procesando || !esCaja}
                              onClick={() => void procesarDevolucion(d)}
                            >
                              Procesar
                            </button>
                          )}

                          {d.estado_financiero === 'pendiente_reembolso' && (
                            <button
                              type="button"
                              className="product-edit-button"
                              disabled={procesando || !esCaja}
                              onClick={() => {
                                limpiarMensajes()
                                setDevolucionReembolso(d)
                              }}
                            >
                              Reembolsar
                            </button>
                          )}

                          {['aplicada_cxc', 'reembolsada'].includes(d.estado_financiero) && '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  // Historial
  const sesionDetalle = sesionHistorial
  const movimientosDetalle = sesionDetalle
    ? movimientos.filter(m => m.sesion_caja_id === sesionDetalle.id)
    : []
  const arqueoDetalle = sesionDetalle
    ? arqueos.find(a => a.sesion_caja_id === sesionDetalle.id) ?? null
    : null

  return (
    <div className="cash-module">
      {cabecera}
      {mensajes}

      {sesionDetalle && (
        <section className="cash-card">
          <div className="cash-section-head">
            <div>
              <span className="panel-label">DETALLE DE JORNADA</span>
              <h3>{sesionDetalle.numero}</h3>
            </div>
            <button
              className="product-close-button"
              type="button"
              onClick={() => setSesionHistorial(null)}
            >
              ×
            </button>
          </div>

          <div className="cash-summary-grid cash-summary-grid--4">
            <div><span>APERTURA</span><strong>{fecha(sesionDetalle.fecha_apertura)}</strong></div>
            <div><span>FONDO INICIAL</span><strong>{dinero(sesionDetalle.monto_inicial)}</strong></div>
            <div><span>CIERRE</span><strong>{fecha(sesionDetalle.fecha_cierre)}</strong></div>
            <div><span>DIFERENCIA</span><strong>{arqueoDetalle ? dinero(arqueoDetalle.diferencia) : '—'}</strong></div>
          </div>

          <div className="cash-table-wrap">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Método</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {movimientosDetalle.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="inventory-empty">
                      Esta jornada no tiene movimientos.
                    </td>
                  </tr>
                ) : (
                  movimientosDetalle.map(m => (
                    <tr key={m.id}>
                      <td>{fecha(m.created_at)}</td>
                      <td>{m.tipo}</td>
                      <td>{m.concepto}</td>
                      <td>{etiquetaMetodo(m.metodo_pago)}</td>
                      <td><strong>{dinero(m.monto)}</strong></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="cash-card">
        <div className="cash-section-head">
          <div>
            <span className="panel-label">HISTORIAL</span>
            <h3>Jornadas de caja</h3>
          </div>
          <span className="sales-result-count">{sesiones.length} jornadas</span>
        </div>

        <div className="cash-table-wrap">
          <table className="cash-table">
            <thead>
              <tr>
                <th>Jornada</th>
                <th>Apertura</th>
                <th>Fondo inicial</th>
                <th>Estado</th>
                <th>Cierre</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sesiones.length === 0 ? (
                <tr>
                  <td colSpan={6} className="inventory-empty">
                    No existen jornadas de caja registradas.
                  </td>
                </tr>
              ) : (
                sesiones.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.numero}</strong></td>
                    <td>{fecha(s.fecha_apertura)}</td>
                    <td>{dinero(s.monto_inicial)}</td>
                    <td>
                      <span className={s.estado === 'abierta' ? 'cash-open-badge' : 'cash-closed-badge'}>
                        {s.estado}
                      </span>
                    </td>
                    <td>{fecha(s.fecha_cierre)}</td>
                    <td>
                      <button
                        type="button"
                        className="product-edit-button"
                        onClick={() => setSesionHistorial(s)}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
