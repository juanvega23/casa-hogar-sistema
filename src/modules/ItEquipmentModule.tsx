import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  claseEstadoEquipo,
  cordobas,
  ESTADOS_EQUIPO,
  fechaCorta,
  fechaHora,
  hoyManagua,
  TIPOS_EQUIPO,
  type EventoHistorial,
} from '../lib/soporteTi'

/*
 * Soporte TI → Equipos de TI: inventario de equipos, quién los tiene
 * e historial. Gerencia lo consulta. No confundir con el inventario
 * de productos: estos equipos no se venden.
 */

type Equipo = {
  id: number
  codigo: string
  tipo: string
  descripcion: string
  numero_serie: string | null
  fecha_compra: string | null
  costo: number | null
  garantia_hasta: string | null
  estado: string
  responsable_id: string | null
  responsable_nombre: string | null
  destino: string | null
  incidencias: number
}

type Empleado = { id: string, nombre: string, rol: string }

const EQUIPO_VACIO = {
  tipo: 'laptop',
  descripcion: '',
  numero_serie: '',
  fecha_compra: '',
  costo: '',
  garantia_hasta: '',
  destino: '',
}

export default function ItEquipmentModule({ soloConsulta }: { soloConsulta: boolean }) {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [personal, setPersonal] = useState<Empleado[]>([])
  const [form, setForm] = useState(EQUIPO_VACIO)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<Equipo | null>(null)
  const [estadoDe, setEstadoDe] = useState<Equipo | null>(null)
  const [estadoNuevo, setEstadoNuevo] = useState('disponible')
  const [responsable, setResponsable] = useState('')
  const [motivo, setMotivo] = useState('')
  const [historialDe, setHistorialDe] = useState<Equipo | null>(null)
  const [historial, setHistorial] = useState<EventoHistorial[]>([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  function cargar() {
    return supabase.rpc('listar_equipos_ti').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setEquipos(((data ?? []) as Equipo[]).map(equipo => ({
        ...equipo,
        costo: equipo.costo === null ? null : Number(equipo.costo),
        incidencias: Number(equipo.incidencias),
      })))
    })
  }

  useEffect(() => {
    void cargar()

    if (!soloConsulta) {
      void supabase.rpc('personal_para_equipos').then(({ data }) => setPersonal((data ?? []) as Empleado[]))
    }
  }, [soloConsulta])

  function cerrarPaneles() {
    setMostrarForm(false)
    setEditando(null)
    setEstadoDe(null)
    setHistorialDe(null)
    setError('')
    setExito('')
  }

  function abrirNuevo() {
    cerrarPaneles()
    setForm(EQUIPO_VACIO)
    setMostrarForm(true)
  }

  function abrirEdicion(equipo: Equipo) {
    cerrarPaneles()
    setEditando(equipo)
    setForm({
      tipo: equipo.tipo,
      descripcion: equipo.descripcion,
      numero_serie: equipo.numero_serie ?? '',
      fecha_compra: equipo.fecha_compra ?? '',
      costo: equipo.costo === null ? '' : String(equipo.costo),
      garantia_hasta: equipo.garantia_hasta ?? '',
      destino: equipo.destino ?? '',
    })
    setMostrarForm(true)
  }

  function abrirEstado(equipo: Equipo) {
    cerrarPaneles()
    setEstadoDe(equipo)
    setEstadoNuevo(equipo.estado === 'por_adquirir' ? 'disponible' : equipo.estado)
    setResponsable(equipo.responsable_id ?? '')
    setMotivo('')
  }

  async function abrirHistorial(equipo: Equipo) {
    cerrarPaneles()
    setHistorialDe(equipo)
    setHistorial([])

    const { data, error: rpcError } = await supabase.rpc('historial_equipo_ti', { p_id: equipo.id })

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setHistorial((data ?? []) as EventoHistorial[])
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')
    setProcesando(true)

    const { error: rpcError } = await supabase.rpc('guardar_equipo_ti', {
      p_id: editando?.id ?? null,
      p_tipo: form.tipo,
      p_descripcion: form.descripcion,
      p_numero_serie: form.numero_serie,
      p_fecha_compra: form.fecha_compra || null,
      p_costo: form.costo === '' ? null : Number(form.costo),
      p_garantia_hasta: form.garantia_hasta || null,
      p_destino: form.destino,
    })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(editando ? `Equipo ${editando.codigo} actualizado.` : 'Equipo registrado.')
    setMostrarForm(false)
    setEditando(null)
    await cargar()
  }

  async function guardarEstado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!estadoDe) return

    setError('')
    setExito('')
    setProcesando(true)

    const { error: rpcError } = await supabase.rpc('cambiar_estado_equipo_ti', {
      p_id: estadoDe.id,
      p_estado: estadoNuevo,
      p_responsable_id: estadoNuevo === 'asignado' ? responsable || null : null,
      p_motivo: motivo,
    })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(`Equipo ${estadoDe.codigo}: ${ESTADOS_EQUIPO[estadoNuevo]}.`)
    setEstadoDe(null)
    await cargar()
  }

  const hoy = hoyManagua()

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando equipos...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Equipos de TI</h2>
          <p>Equipos de la empresa, quién los tiene y su historial. No son productos de venta.</p>
        </div>

        {!soloConsulta && (
          <button type="button" className="product-primary-button" onClick={abrirNuevo}>
            + Nuevo equipo
          </button>
        )}
      </section>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      {mostrarForm && (
        <form key={editando?.id ?? 'nuevo'} className="cash-card cash-form soporte-form" onSubmit={guardar}>
          <label>
            Tipo
            <select value={form.tipo} onChange={event => setForm({ ...form, tipo: event.target.value })}>
              {Object.entries(TIPOS_EQUIPO).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
            </select>
          </label>
          <label className="soporte-campo-doble">
            Marca y modelo
            <input value={form.descripcion} onChange={event => setForm({ ...form, descripcion: event.target.value })} required />
          </label>
          <label>
            Número de serie
            <input value={form.numero_serie} onChange={event => setForm({ ...form, numero_serie: event.target.value })} />
          </label>
          <label>
            Fecha de compra
            <input type="date" max={hoy} value={form.fecha_compra} onChange={event => setForm({ ...form, fecha_compra: event.target.value })} />
          </label>
          <label>
            Costo (C$)
            <input type="number" min="0" step="0.01" value={form.costo} onChange={event => setForm({ ...form, costo: event.target.value })} />
          </label>
          <label>
            Garantía hasta
            <input type="date" value={form.garantia_hasta} onChange={event => setForm({ ...form, garantia_hasta: event.target.value })} />
          </label>
          <label className="soporte-campo-doble">
            Destino o ubicación
            <input value={form.destino} onChange={event => setForm({ ...form, destino: event.target.value })} placeholder="Por ejemplo: Caja, Bodega, Técnico de Soporte" />
          </label>
          <div className="cash-actions cash-field-full">
            <button type="button" className="product-secondary-button" disabled={procesando} onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
            <button type="submit" className="product-primary-button" disabled={procesando}>
              {procesando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar equipo'}
            </button>
          </div>
        </form>
      )}

      {estadoDe && (
        <form key={estadoDe.id} className="cash-card cash-form soporte-form" onSubmit={guardarEstado}>
          <div className="cash-field-full">
            <span className="panel-label">{estadoDe.codigo}</span>
            <h3>{estadoDe.descripcion}</h3>
          </div>
          <label>
            Nuevo estado
            <select value={estadoNuevo} onChange={event => setEstadoNuevo(event.target.value)}>
              <option value="disponible">{ESTADOS_EQUIPO.disponible}</option>
              <option value="asignado">{ESTADOS_EQUIPO.asignado}</option>
              <option value="en_reparacion">{ESTADOS_EQUIPO.en_reparacion}</option>
              <option value="baja">{ESTADOS_EQUIPO.baja}</option>
            </select>
          </label>
          {estadoNuevo === 'asignado' && (
            <label>
              Responsable
              <select value={responsable} onChange={event => setResponsable(event.target.value)} required>
                <option value="">Seleccionar</option>
                {personal.map(empleado => <option key={empleado.id} value={empleado.id}>{empleado.nombre} · {empleado.rol}</option>)}
              </select>
            </label>
          )}
          {(estadoNuevo === 'en_reparacion' || estadoNuevo === 'baja') && (
            <label className="soporte-campo-doble">
              Motivo
              <input value={motivo} onChange={event => setMotivo(event.target.value)} required />
            </label>
          )}
          {estadoNuevo === 'baja' && (
            <p className="cash-help cash-field-full">Dar de baja es definitivo: el equipo y su historial se conservan, pero ya no se puede usar.</p>
          )}
          <div className="cash-actions cash-field-full">
            <button type="button" className="product-secondary-button" disabled={procesando} onClick={() => setEstadoDe(null)}>
              Cancelar
            </button>
            <button type="submit" className="product-primary-button" disabled={procesando}>
              {procesando ? 'Guardando...' : 'Cambiar estado'}
            </button>
          </div>
        </form>
      )}

      {historialDe && (
        <section key={historialDe.id} className="cash-card soporte-detalle">
          <header className="soporte-detalle-cabeza">
            <div>
              <span className="panel-label">{historialDe.codigo}</span>
              <h3>{historialDe.descripcion}</h3>
            </div>
            <button type="button" className="product-secondary-button" onClick={() => setHistorialDe(null)}>
              Cerrar
            </button>
          </header>
          <p className="cash-help">Incidencias relacionadas: {historialDe.incidencias}</p>
          {historial.length === 0 && <p className="cash-help">Todavía no tiene movimientos.</p>}
          <ol className="soporte-historial">
            {historial.map((evento, indice) => (
              <li key={indice}>
                <strong>{evento.accion}</strong>
                {evento.detalle && <span>{evento.detalle}</span>}
                <small>{evento.usuario} · {fechaHora(evento.created_at)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Equipo</th>
              <th>Responsable o destino</th>
              <th>Costo</th>
              <th>Garantía</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {equipos.length === 0 && (
              <tr><td colSpan={7} className="inventory-empty">No hay equipos registrados.</td></tr>
            )}
            {equipos.map(equipo => (
              <tr key={equipo.id}>
                <td className="kardex-documento">{equipo.codigo}</td>
                <td>
                  <strong>{equipo.descripcion}</strong>
                  <div className="soporte-celda-sub">{TIPOS_EQUIPO[equipo.tipo]}{equipo.numero_serie ? ` · Serie ${equipo.numero_serie}` : ''}</div>
                </td>
                <td>{equipo.responsable_nombre ?? equipo.destino ?? '—'}</td>
                <td>{cordobas(equipo.costo)}</td>
                <td>
                  {fechaCorta(equipo.garantia_hasta)}
                  {equipo.garantia_hasta && equipo.garantia_hasta < hoy && equipo.estado !== 'baja' && (
                    <div className="soporte-celda-sub">Vencida</div>
                  )}
                </td>
                <td><span className={claseEstadoEquipo(equipo.estado)}>{ESTADOS_EQUIPO[equipo.estado]}</span></td>
                <td>
                  <div className="cuentas-acciones">
                    <button type="button" className="product-edit-button" onClick={() => void abrirHistorial(equipo)}>Historial</button>
                    {!soloConsulta && equipo.estado !== 'baja' && (
                      <>
                        <button type="button" className="product-edit-button" onClick={() => abrirEdicion(equipo)}>Editar</button>
                        <button type="button" className="product-secondary-button" onClick={() => abrirEstado(equipo)}>Estado</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
