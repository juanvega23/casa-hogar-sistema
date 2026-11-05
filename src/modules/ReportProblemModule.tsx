import {
  useEffect,
  useState,
  type FormEvent,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  claseEstadoIncidencia,
  ESTADOS_INCIDENCIA,
  fechaHora,
  IMPACTOS,
  TIPOS_INCIDENCIA,
} from '../lib/soporteTi'

/*
 * "Reportar un problema": lo usa cualquier empleado desde la barra
 * lateral. Reporta una incidencia a Soporte TI, ve cómo van las suyas
 * y confirma si quedaron resueltas.
 */

type MiIncidencia = {
  id: number
  numero: string
  descripcion: string
  modulo: string | null
  tipo: string
  estado: string
  solucion: string | null
  atendido_nombre: string | null
  created_at: string
}

export default function ReportProblemModule({ modulo }: { modulo: string }) {
  const [incidencias, setIncidencias] = useState<MiIncidencia[]>([])
  const [descripcion, setDescripcion] = useState('')
  const [moduloForm, setModuloForm] = useState(modulo)
  const [tipo, setTipo] = useState('sistema')
  const [impacto, setImpacto] = useState('parcial')
  const [devolviendo, setDevolviendo] = useState<number | null>(null)
  const [comentario, setComentario] = useState('')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  function cargar() {
    return supabase.rpc('mis_incidencias').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setIncidencias((data ?? []) as MiIncidencia[])
    })
  }

  useEffect(() => {
    void cargar()
  }, [])

  async function reportar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExito('')
    setProcesando(true)

    const { data, error: rpcError } = await supabase.rpc('reportar_incidencia', {
      p_descripcion: descripcion,
      p_modulo: moduloForm,
      p_tipo: tipo,
      p_impacto: impacto,
    })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    const fila = (Array.isArray(data) ? data[0] : data) as { numero: string }

    setExito(`Reporte ${fila.numero} enviado a Soporte TI. Puedes ver cómo va en esta misma pantalla.`)
    setDescripcion('')
    await cargar()
  }

  async function confirmar(incidencia: MiIncidencia, resuelta: boolean) {
    setError('')
    setExito('')
    setProcesando(true)

    const { error: rpcError } = await supabase.rpc('confirmar_incidencia', {
      p_incidencia_id: incidencia.id,
      p_resuelta: resuelta,
      p_comentario: resuelta ? null : comentario,
    })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(resuelta ? `Reporte ${incidencia.numero} cerrado. Gracias por confirmar.` : `Reporte ${incidencia.numero} devuelto a Soporte TI.`)
    setDevolviendo(null)
    setComentario('')
    await cargar()
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Reportar un problema</h2>
          <p>Cuéntale a Soporte TI qué está fallando. Te responderá en esta pantalla.</p>
        </div>
      </section>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      <form className="cash-card cash-form soporte-form" onSubmit={reportar}>
        <label className="cash-field-full">
          ¿Qué pasó?
          <textarea
            value={descripcion}
            onChange={event => setDescripcion(event.target.value)}
            placeholder="Por ejemplo: no carga la pantalla de Cobros"
            required
          />
        </label>
        <label>
          Módulo o lugar
          <input value={moduloForm} onChange={event => setModuloForm(event.target.value)} />
        </label>
        <label>
          Tipo de problema
          <select value={tipo} onChange={event => setTipo(event.target.value)}>
            {Object.entries(TIPOS_INCIDENCIA).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
          </select>
        </label>
        <label>
          ¿Te impide trabajar?
          <select value={impacto} onChange={event => setImpacto(event.target.value)}>
            <option value="bloquea">{IMPACTOS.bloquea}</option>
            <option value="parcial">{IMPACTOS.parcial}</option>
            <option value="no">{IMPACTOS.no}</option>
          </select>
        </label>
        <div className="cash-actions cash-field-full">
          <button type="submit" className="product-primary-button" disabled={procesando}>
            {procesando ? 'Enviando...' : 'Enviar reporte'}
          </button>
        </div>
      </form>

      <section className="cash-card">
        <span className="panel-label">MIS REPORTES</span>
        <h3>Cómo van tus reportes</h3>

        {cargando && <p className="cash-help">Cargando...</p>}
        {!cargando && incidencias.length === 0 && <p className="cash-help">Todavía no enviaste ningún reporte.</p>}

        <div className="soporte-lista">
          {incidencias.map(incidencia => (
            <article key={incidencia.id} className="soporte-reporte">
              <header>
                <span className="kardex-documento">{incidencia.numero}</span>
                <span className={claseEstadoIncidencia(incidencia.estado)}>{ESTADOS_INCIDENCIA[incidencia.estado]}</span>
                <small>{TIPOS_INCIDENCIA[incidencia.tipo]}{incidencia.modulo ? ` · ${incidencia.modulo}` : ''} · {fechaHora(incidencia.created_at)}</small>
              </header>

              <p>{incidencia.descripcion}</p>

              {incidencia.solucion && (
                <p className="soporte-solucion">
                  <strong>Solución{incidencia.atendido_nombre ? ` de ${incidencia.atendido_nombre}` : ''}:</strong> {incidencia.solucion}
                </p>
              )}

              {incidencia.estado === 'resuelta' && devolviendo !== incidencia.id && (
                <div className="soporte-acciones">
                  <button type="button" className="product-primary-button" disabled={procesando} onClick={() => void confirmar(incidencia, true)}>
                    Quedó resuelto
                  </button>
                  <button
                    type="button"
                    className="product-secondary-button"
                    disabled={procesando}
                    onClick={() => {
                      setDevolviendo(incidencia.id)
                      setComentario('')
                    }}
                  >
                    Sigue igual
                  </button>
                  <small>Si no respondes en 3 días, se cierra sola.</small>
                </div>
              )}

              {devolviendo === incidencia.id && (
                <div className="soporte-devolver cash-form">
                  <label>
                    ¿Qué sigue fallando?
                    <textarea value={comentario} onChange={event => setComentario(event.target.value)} />
                  </label>
                  <div className="soporte-acciones">
                    <button type="button" className="product-primary-button" disabled={procesando} onClick={() => void confirmar(incidencia, false)}>
                      Devolver a Soporte
                    </button>
                    <button type="button" className="product-secondary-button" disabled={procesando} onClick={() => setDevolviendo(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
