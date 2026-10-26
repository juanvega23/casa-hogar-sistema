import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'

type AccountsReceivableModuleProps = {
  roleCode: string
}

type VentaRelacion = {
  numero: string
  cliente_nombre: string | null
  total: number | string
  created_at: string
}

type CuentaRespuesta = {
  id: number
  venta_id: number
  fecha_vencimiento: string
  saldo_pendiente: number | string
  estado: string
  created_at: string
  ventas: VentaRelacion | VentaRelacion[] | null
}

type EstadoCuenta = 'pendiente' | 'vencida' | 'pagada'

type Cuenta = {
  id: number
  venta_id: number
  venta_numero: string
  cliente_nombre: string
  total_venta: number
  saldo_pendiente: number
  abonado: number
  fecha_venta: string | null
  fecha_vencimiento: string
  dias_vencida: number
  estado: EstadoCuenta
}

function relacion<T>(valor: T | T[] | null): T | null {
  if (!valor) return null
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function formatearCordobas(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(valor)
}

function formatearFechaCorta(valor: string | null) {
  if (!valor) return '—'
  // Las fechas sin hora (YYYY-MM-DD) se interpretan como fecha local.
  const fecha = valor.length === 10
    ? new Date(`${valor}T00:00:00`)
    : new Date(valor)
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'medium',
  }).format(fecha)
}

function hoyLocal() {
  const ahora = new Date()
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
}

function diasDesde(fecha: string) {
  const vencimiento = new Date(`${fecha}T00:00:00`)
  const diferencia = hoyLocal().getTime() - vencimiento.getTime()
  return Math.floor(diferencia / 86_400_000)
}

/*
 * El estado 'vencida' no lo actualiza ningún proceso en la base
 * de datos; se calcula aquí a partir de la fecha de vencimiento.
 */
function calcularEstado(saldo: number, fechaVencimiento: string): EstadoCuenta {
  if (saldo <= 0) return 'pagada'
  return diasDesde(fechaVencimiento) > 0 ? 'vencida' : 'pendiente'
}

function etiquetaEstado(estado: EstadoCuenta) {
  if (estado === 'pagada') return 'Pagada'
  if (estado === 'vencida') return 'Vencida'
  return 'Al día'
}

function claseEstado(estado: EstadoCuenta) {
  if (estado === 'pagada') return 'history-status history-status--ok'
  if (estado === 'vencida') return 'history-status history-status--danger'
  return 'history-status history-status--pending'
}

export default function AccountsReceivableModule({
  roleCode,
}: AccountsReceivableModuleProps) {
  const puedeConsultar =
    roleCode === 'responsable_comercial' ||
    roleCode === 'gerencia'

  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('con_saldo')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cuentasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    return cuentas.filter(cuenta => {
      const coincideBusqueda =
        !termino ||
        cuenta.venta_numero.toLowerCase().includes(termino) ||
        cuenta.cliente_nombre.toLowerCase().includes(termino)

      const coincideFiltro =
        filtro === 'todas' ||
        (filtro === 'con_saldo'
          ? cuenta.estado !== 'pagada'
          : cuenta.estado === filtro)

      return coincideBusqueda && coincideFiltro
    })
  }, [cuentas, busqueda, filtro])

  const resumen = useMemo(() => {
    const conSaldo = cuentas.filter(c => c.estado !== 'pagada')
    const vencidas = cuentas.filter(c => c.estado === 'vencida')

    return {
      pendiente: conSaldo.reduce((a, c) => a + c.saldo_pendiente, 0),
      vencido: vencidas.reduce((a, c) => a + c.saldo_pendiente, 0),
      cuentasVencidas: vencidas.length,
      cuentasAbiertas: conSaldo.length,
    }
  }, [cuentas])

  async function cargarCuentas() {
    if (!puedeConsultar) {
      setCargando(false)
      return
    }

    setCargando(true)
    setError('')

    const { data, error: cuentasError } =
      await supabase
        .from('cuentas_por_cobrar')
        .select(`
          id,
          venta_id,
          fecha_vencimiento,
          saldo_pendiente,
          estado,
          created_at,
          ventas (
            numero,
            cliente_nombre,
            total,
            created_at
          )
        `)
        .order('fecha_vencimiento', { ascending: true })

    if (cuentasError) {
      setError(cuentasError.message)
      setCuentas([])
      setCargando(false)
      return
    }

    const respuesta = (data ?? []) as unknown as CuentaRespuesta[]

    setCuentas(
      respuesta.map(item => {
        const venta = relacion(item.ventas)
        const saldo = Number(item.saldo_pendiente ?? 0)
        const totalVenta = Number(venta?.total ?? 0)
        const estado = calcularEstado(saldo, item.fecha_vencimiento)

        return {
          id: Number(item.id),
          venta_id: Number(item.venta_id),
          venta_numero: venta?.numero ?? `Venta ${item.venta_id}`,
          cliente_nombre: venta?.cliente_nombre ?? 'Cliente',
          total_venta: totalVenta,
          saldo_pendiente: saldo,
          abonado: Math.max(0, totalVenta - saldo),
          fecha_venta: venta?.created_at ?? null,
          fecha_vencimiento: item.fecha_vencimiento,
          dias_vencida:
            estado === 'vencida'
              ? diasDesde(item.fecha_vencimiento)
              : 0,
          estado,
        }
      }),
    )

    setCargando(false)
  }

  useEffect(() => {
    void cargarCuentas()
  }, [roleCode])

  if (!puedeConsultar) {
    return (
      <div className="inventory-error">
        Este perfil no tiene acceso a cuentas por cobrar.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando cuentas por cobrar...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">CRÉDITO</span>
          <h2>Cuentas por cobrar</h2>
          <p>
            Consulta los saldos de las ventas a crédito. Los abonos se registran en el Módulo Caja.
          </p>
        </div>

        <button
          type="button"
          className="inventory-refresh-button"
          onClick={() => void cargarCuentas()}
        >
          ↻ Actualizar
        </button>
      </section>

      <div className="history-summary-grid">
        <article className="history-summary-card">
          <span>SALDO PENDIENTE</span>
          <strong>{formatearCordobas(resumen.pendiente)}</strong>
          <p>{resumen.cuentasAbiertas} cuentas con saldo</p>
        </article>

        <article className="history-summary-card">
          <span>SALDO VENCIDO</span>
          <strong>{formatearCordobas(resumen.vencido)}</strong>
          <p>requiere seguimiento</p>
        </article>

        <article className="history-summary-card">
          <span>CUENTAS VENCIDAS</span>
          <strong>{resumen.cuentasVencidas}</strong>
          <p>fecha límite superada</p>
        </article>

        <article className="history-summary-card">
          <span>TOTAL DE CUENTAS</span>
          <strong>{cuentas.length}</strong>
          <p>ventas a crédito registradas</p>
        </article>
      </div>

      {error && <div className="inventory-error">{error}</div>}

      <section className="history-list-card">
        <div className="history-list-head">
          <div>
            <span className="panel-label">CARTERA</span>
            <h3>Detalle de cuentas</h3>
          </div>

          <span className="sales-result-count">
            {cuentasFiltradas.length}{' '}
            resultado{cuentasFiltradas.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="history-filters">
          <div className="clients-search">
            <span>⌕</span>
            <input
              type="text"
              value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar por número de venta o cliente..."
            />
          </div>

          <select
            value={filtro}
            onChange={event => setFiltro(event.target.value)}
          >
            <option value="con_saldo">Con saldo pendiente</option>
            <option value="vencida">Vencidas</option>
            <option value="pendiente">Al día</option>
            <option value="pagada">Pagadas</option>
            <option value="todas">Todas</option>
          </select>
        </div>

        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Venta</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Abonado</th>
                <th>Saldo</th>
                <th>Vencimiento</th>
                <th>Estado</th>
              </tr>
            </thead>

            <tbody>
              {cuentasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="inventory-empty">
                    No se encontraron cuentas.
                  </td>
                </tr>
              ) : (
                cuentasFiltradas.map(cuenta => (
                  <tr key={cuenta.id}>
                    <td>
                      <strong>{cuenta.venta_numero}</strong>
                      <small>{formatearFechaCorta(cuenta.fecha_venta)}</small>
                    </td>

                    <td>{cuenta.cliente_nombre}</td>

                    <td>{formatearCordobas(cuenta.total_venta)}</td>

                    <td>{formatearCordobas(cuenta.abonado)}</td>

                    <td>
                      <strong>{formatearCordobas(cuenta.saldo_pendiente)}</strong>
                    </td>

                    <td>
                      {formatearFechaCorta(cuenta.fecha_vencimiento)}
                      {cuenta.dias_vencida > 0 && (
                        <small>
                          {cuenta.dias_vencida} día{cuenta.dias_vencida === 1 ? '' : 's'} de atraso
                        </small>
                      )}
                    </td>

                    <td>
                      <span className={claseEstado(cuenta.estado)}>
                        {etiquetaEstado(cuenta.estado)}
                      </span>
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
