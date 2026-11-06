import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import { fechaCorta, hoyManagua } from '../lib/soporteTi'
import Paginador from './Paginador'
import { usePaginacion } from '../lib/paginacion'
import FiltroColumna from './FiltroColumna'
import { opcionesDe } from '../lib/filtroColumna'

/*
 * Soporte TI → Respaldos: bitácora de copias y pruebas de restauración.
 * Registra lo que se hizo; NO ejecuta la copia (esa se hace en Supabase
 * o en el almacenamiento externo).
 */

type Respaldo = {
  id: number
  fecha: string
  tipo: string
  destino: string
  resultado: string
  duracion_minutos: number | null
  observaciones: string | null
  registrado_nombre: string | null
}

const DIAS_ALERTA = 7

export default function BackupsModule({ soloConsulta }: { soloConsulta: boolean }) {
  const [respaldos, setRespaldos] = useState<Respaldo[]>([])
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroDestino, setFiltroDestino] = useState('')
  const [filtroResultado, setFiltroResultado] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [fecha, setFecha] = useState(hoyManagua())
  const [tipo, setTipo] = useState('copia')
  const [destino, setDestino] = useState('Supabase')
  const [resultado, setResultado] = useState('exitoso')
  const [duracion, setDuracion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  function cargar() {
    return supabase.rpc('listar_respaldos').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setRespaldos((data ?? []) as Respaldo[])
    })
  }

  useEffect(() => {
    void cargar()
  }, [])

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')
    setProcesando(true)

    const { error: rpcError } = await supabase.rpc('registrar_respaldo', {
      p_fecha: fecha,
      p_tipo: tipo,
      p_destino: destino,
      p_resultado: resultado,
      p_duracion_minutos: duracion === '' ? null : Number(duracion),
      p_observaciones: observaciones,
    })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(tipo === 'copia' ? 'Copia registrada en la bitácora.' : 'Prueba de restauración registrada en la bitácora.')
    setMostrarForm(false)
    setDuracion('')
    setObservaciones('')
    setResultado('exitoso')
    await cargar()
  }

  const hoy = hoyManagua()
  const ultimaCopia = respaldos.find(r => r.tipo === 'copia' && r.resultado === 'exitoso')?.fecha ?? null
  const diasSinCopia = ultimaCopia
    ? Math.round((Date.parse(hoy) - Date.parse(ultimaCopia)) / 86400000)
    : null
  const pruebas = respaldos.filter(r => r.tipo === 'restauracion')
  const exitosas = pruebas.filter(r => r.resultado === 'exitoso').length
  const porcentaje = pruebas.length ? Math.round((exitosas / pruebas.length) * 100) : null
  const respaldosFiltrados = respaldos.filter(r =>
    (!filtroTipo || r.tipo === filtroTipo) &&
    (!filtroDestino || r.destino === filtroDestino) &&
    (!filtroResultado || r.resultado === filtroResultado),
  )

  const paginacion = usePaginacion(respaldosFiltrados)

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando respaldos...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Respaldos</h2>
          <p>Bitácora de copias y pruebas de restauración. Registra el resultado; la copia se hace en el servicio de respaldo.</p>
        </div>

        {!soloConsulta && (
          <button
            type="button"
            className="product-primary-button"
            onClick={() => {
              setMostrarForm(true)
              setFecha(hoyManagua())
              setError('')
              setExito('')
            }}
          >
            + Registrar
          </button>
        )}
      </section>

      <div className="sales-summary-grid">
        <div className="sales-summary-card">
          <span>ÚLTIMA COPIA EXITOSA</span>
          <strong>{fechaCorta(ultimaCopia)}</strong>
          <small>{diasSinCopia === null ? 'sin copias registradas' : diasSinCopia === 0 ? 'hoy' : `hace ${diasSinCopia} día${diasSinCopia === 1 ? '' : 's'}`}</small>
        </div>
        <div className="sales-summary-card">
          <span>PRUEBAS DE RESTAURACIÓN</span>
          <strong>{pruebas.length}</strong>
          <small>realizadas</small>
        </div>
        <div className="sales-summary-card">
          <span>PRUEBAS SATISFACTORIAS</span>
          <strong>{porcentaje === null ? '—' : `${porcentaje} %`}</strong>
          <small>satisfactorias / realizadas × 100</small>
        </div>
        <div className="sales-summary-card">
          <span>ÚLTIMA PRUEBA</span>
          <strong>{fechaCorta(pruebas[0]?.fecha ?? null)}</strong>
          <small>{pruebas[0] ? (pruebas[0].resultado === 'exitoso' ? 'exitosa' : 'fallida') : 'sin pruebas registradas'}</small>
        </div>
      </div>

      {(diasSinCopia === null || diasSinCopia >= DIAS_ALERTA) && (
        <div className="soporte-aviso">
          {diasSinCopia === null
            ? 'Todavía no hay ninguna copia exitosa registrada.'
            : `Pasaron ${diasSinCopia} días sin una copia exitosa registrada.`}
        </div>
      )}

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      {mostrarForm && (
        <form className="cash-card cash-form soporte-form" onSubmit={guardar}>
          <label>
            Fecha
            <input type="date" max={hoy} value={fecha} onChange={event => setFecha(event.target.value)} required />
          </label>
          <label>
            Tipo
            <select value={tipo} onChange={event => setTipo(event.target.value)}>
              <option value="copia">Copia</option>
              <option value="restauracion">Prueba de restauración</option>
            </select>
          </label>
          <label>
            Dónde está la copia
            <input value={destino} onChange={event => setDestino(event.target.value)} required />
          </label>
          <label>
            Resultado
            <select value={resultado} onChange={event => setResultado(event.target.value)}>
              <option value="exitoso">Exitoso</option>
              <option value="fallido">Fallido</option>
            </select>
          </label>
          <label>
            Duración (minutos)
            <input type="number" min="0" step="1" value={duracion} onChange={event => setDuracion(event.target.value)} />
          </label>
          <label className="cash-field-full">
            Observaciones{resultado === 'fallido' ? ' (cuenta qué falló)' : ''}
            <textarea value={observaciones} onChange={event => setObservaciones(event.target.value)} required={resultado === 'fallido'} />
          </label>
          <div className="cash-actions cash-field-full">
            <button type="button" className="product-secondary-button" disabled={procesando} onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
            <button type="submit" className="product-primary-button" disabled={procesando}>
              {procesando ? 'Guardando...' : 'Guardar registro'}
            </button>
          </div>
        </form>
      )}

      <div className="history-table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <FiltroColumna titulo="Tipo" todos="Copias y restauraciones" valor={filtroTipo} opciones={[['copia', 'Copia'], ['restauracion', 'Restauración']]} onCambiar={setFiltroTipo} />
              <FiltroColumna titulo="Destino" todos="Todos los destinos" valor={filtroDestino} opciones={opcionesDe(respaldos, r => r.destino)} onCambiar={setFiltroDestino} />
              <FiltroColumna titulo="Resultado" todos="Todos los resultados" valor={filtroResultado} opciones={[['exitoso', 'Exitoso'], ['fallido', 'Fallido']]} onCambiar={setFiltroResultado} />
              <th>Duración</th>
              <th>Observaciones</th>
              <th>Registró</th>
            </tr>
          </thead>
          <tbody>
            {respaldosFiltrados.length === 0 && (
              <tr><td colSpan={7} className="inventory-empty">No hay registros para mostrar.</td></tr>
            )}
            {paginacion.visibles.map(respaldo => (
              <tr key={respaldo.id}>
                <td>{fechaCorta(respaldo.fecha)}</td>
                <td>{respaldo.tipo === 'copia' ? 'Copia' : 'Restauración'}</td>
                <td>{respaldo.destino}</td>
                <td>
                  <span className={respaldo.resultado === 'exitoso' ? 'history-status history-status--ok' : 'history-status history-status--danger'}>
                    {respaldo.resultado === 'exitoso' ? 'Exitoso' : 'Fallido'}
                  </span>
                </td>
                <td>{respaldo.duracion_minutos === null ? '—' : `${respaldo.duracion_minutos} min`}</td>
                <td>{respaldo.observaciones ?? '—'}</td>
                <td>{respaldo.registrado_nombre ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Paginador control={paginacion} />
      </div>
    </div>
  )
}
