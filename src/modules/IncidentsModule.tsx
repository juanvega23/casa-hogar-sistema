import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import { supabase } from '../lib/supabase'
import {
  claseEstadoIncidencia,
  clasePrioridad,
  ESTADOS_INCIDENCIA,
  fechaHora,
  IMPACTOS,
  PRIORIDADES,
  TIPOS_INCIDENCIA,
  type EventoHistorial,
} from '../lib/soporteTi'
import Paginador from './Paginador'
import { usePaginacion } from '../lib/paginacion'
import FiltroColumna from './FiltroColumna'
import { opcionesDe, type OpcionColumna } from '../lib/filtroColumna'

const OPCIONES_ESTADO: OpcionColumna[] = [
  ['pendientes', 'Pendientes'],
  ['abierta', 'Abierta'],
  ['en_atencion', 'En atención'],
  ['resuelta', 'Resuelta, por confirmar'],
  ['cerrada', 'Cerrada'],
]

/*
 * Soporte TI → Incidencias: atiende lo que reporta el personal.
 * Gerencia entra en modo consulta; la base lo impone de todos modos.
 */

type Incidencia = {
  id: number
  numero: string
  descripcion: string
  modulo: string | null
  tipo: string
  impacto: string
  prioridad: string
  estado: string
  solucion: string | null
  equipo_codigo: string | null
  reportado_nombre: string | null
  atendido_nombre: string | null
  created_at: string
  resuelta_at: string | null
  cerrada_at: string | null
}

type EquipoOpcion = { id: number, codigo: string, descripcion: string, estado: string }

export default function IncidentsModule({ soloConsulta }: { soloConsulta: boolean }) {
  const [incidencias, setIncidencias] = useState<Incidencia[]>([])
  const [equipos, setEquipos] = useState<EquipoOpcion[]>([])
  const [filtro, setFiltro] = useState('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const [filtroPrioridad, setFiltroPrioridad] = useState('')
  const [filtroReporto, setFiltroReporto] = useState('')
  const [abiertaId, setAbiertaId] = useState<number | null>(null)
  const [historial, setHistorial] = useState<EventoHistorial[]>([])
  const [prioridad, setPrioridad] = useState('media')
  const [equipoId, setEquipoId] = useState('')
  const [nota, setNota] = useState('')
  const [solucion, setSolucion] = useState('')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  function cargar() {
    return supabase.rpc('listar_incidencias').then(({ data, error: rpcError }) => {
      setCargando(false)

      if (rpcError) {
        setError(rpcError.message)
        return
      }

      setIncidencias((data ?? []) as Incidencia[])
    })
  }

  useEffect(() => {
    void cargar()

    if (!soloConsulta) {
      void supabase.rpc('listar_equipos_ti').then(({ data }) => {
        setEquipos(((data ?? []) as EquipoOpcion[]).filter(equipo => equipo.estado !== 'baja'))
      })
    }
  }, [soloConsulta])

  const abierta = incidencias.find(incidencia => incidencia.id === abiertaId) ?? null

  const visibles = useMemo(
    () => {
      const termino = busqueda.trim().toLowerCase()

      return incidencias.filter(incidencia =>
        (!filtro
          ? true
          : filtro === 'pendientes'
            ? incidencia.estado !== 'cerrada'
            : incidencia.estado === filtro) &&
        (!filtroPrioridad || incidencia.prioridad === filtroPrioridad) &&
        (!filtroReporto || incidencia.reportado_nombre === filtroReporto) &&
        (!termino || [incidencia.numero, incidencia.descripcion, incidencia.modulo, incidencia.reportado_nombre]
          .some(texto => (texto ?? '').toLowerCase().includes(termino))),
      )
    },
    [incidencias, filtro, filtroPrioridad, filtroReporto, busqueda],
  )

  const paginacion = usePaginacion(visibles)

  const resumen = useMemo(
    () => ({
      abiertas: incidencias.filter(i => i.estado === 'abierta').length,
      atencion: incidencias.filter(i => i.estado === 'en_atencion').length,
      confirmar: incidencias.filter(i => i.estado === 'resuelta').length,
      cerradas: incidencias.filter(i => i.estado === 'cerrada').length,
    }),
    [incidencias],
  )

  async function pedirHistorial(id: number) {
    const { data, error: rpcError } = await supabase.rpc('historial_incidencia', { p_incidencia_id: id })

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setHistorial((data ?? []) as EventoHistorial[])
  }

  async function abrir(incidencia: Incidencia) {
    setError('')
    setExito('')

    if (abiertaId === incidencia.id) {
      setAbiertaId(null)
      return
    }

    setAbiertaId(incidencia.id)
    setPrioridad(incidencia.prioridad)
    setEquipoId('')
    setNota('')
    setSolucion('')
    setHistorial([])
    await pedirHistorial(incidencia.id)
  }

  async function ejecutar(
    funcion: string,
    parametros: Record<string, unknown>,
    mensaje: string,
  ) {
    if (!abierta) return

    setError('')
    setExito('')
    setProcesando(true)

    const { error: rpcError } = await supabase.rpc(funcion, { p_incidencia_id: abierta.id, ...parametros })

    setProcesando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setExito(`${abierta.numero}: ${mensaje}`)
    setNota('')
    setSolucion('')
    await Promise.all([cargar(), pedirHistorial(abierta.id)])
  }

  if (cargando) {
    return (
      <div className="inventory-loading">
        <div className="inventory-spinner" />
        <span>Cargando incidencias...</span>
      </div>
    )
  }

  return (
    <div className="history-module">
      <section className="history-toolbar">
        <div>
          <span className="panel-label">SOPORTE TI</span>
          <h2>Incidencias</h2>
          <p>
            {soloConsulta
              ? 'Problemas reportados por el personal y cómo se atendieron.'
              : 'Problemas que reporta el personal, con lo más urgente primero.'}
          </p>
        </div>

        <button type="button" className="inventory-refresh-button" onClick={() => void cargar()}>
          ↻ Actualizar
        </button>
      </section>

      <div className="sales-summary-grid">
        <div className="sales-summary-card"><span>ABIERTAS</span><strong>{resumen.abiertas}</strong><small>sin atender</small></div>
        <div className="sales-summary-card"><span>EN ATENCIÓN</span><strong>{resumen.atencion}</strong><small>en proceso</small></div>
        <div className="sales-summary-card"><span>POR CONFIRMAR</span><strong>{resumen.confirmar}</strong><small>resueltas, sin respuesta</small></div>
        <div className="sales-summary-card"><span>CERRADAS</span><strong>{resumen.cerradas}</strong><small>terminadas</small></div>
      </div>

      {error && <div className="inventory-error">{error}</div>}
      {exito && <div className="movement-success">{exito}</div>}

      <div className="history-filters soporte-filtros">
        <div className="clients-search">
          <span>⌕</span>
          <input
            type="text"
            value={busqueda}
            onChange={event => setBusqueda(event.target.value)}
            placeholder="Buscar por número, problema, módulo o quien reportó..."
          />
        </div>
      </div>

      {abierta && (
        <section key={abierta.id} className="cash-card soporte-detalle">
          <header className="soporte-detalle-cabeza">
            <div>
              <span className="panel-label">{abierta.numero}</span>
              <h3>{abierta.descripcion}</h3>
            </div>
            <button type="button" className="product-secondary-button" onClick={() => setAbiertaId(null)}>
              Cerrar
            </button>
          </header>

          <dl className="soporte-datos">
            <div><dt>Reportó</dt><dd>{abierta.reportado_nombre ?? '—'}</dd></div>
            <div><dt>Módulo</dt><dd>{abierta.modulo ?? '—'}</dd></div>
            <div><dt>Tipo</dt><dd>{TIPOS_INCIDENCIA[abierta.tipo]}</dd></div>
            <div><dt>Impacto</dt><dd>{IMPACTOS[abierta.impacto]}</dd></div>
            <div><dt>Atiende</dt><dd>{abierta.atendido_nombre ?? '—'}</dd></div>
            <div><dt>Equipo</dt><dd>{abierta.equipo_codigo ?? '—'}</dd></div>
          </dl>

          {abierta.solucion && <p className="soporte-solucion"><strong>Solución:</strong> {abierta.solucion}</p>}

          {!soloConsulta && abierta.estado === 'abierta' && (
            <div className="cash-form soporte-accion">
              <label>
                Prioridad
                <select value={prioridad} onChange={event => setPrioridad(event.target.value)}>
                  {Object.entries(PRIORIDADES).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
              </label>
              <label>
                Equipo relacionado (opcional)
                <select value={equipoId} onChange={event => setEquipoId(event.target.value)}>
                  <option value="">Ninguno</option>
                  {equipos.map(equipo => <option key={equipo.id} value={equipo.id}>{equipo.codigo} · {equipo.descripcion}</option>)}
                </select>
              </label>
              <div className="cash-actions cash-field-full">
                <button
                  type="button"
                  className="product-primary-button"
                  disabled={procesando}
                  onClick={() => void ejecutar('atender_incidencia', { p_prioridad: prioridad, p_equipo_id: equipoId ? Number(equipoId) : null }, 'pasó a En atención.')}
                >
                  Atender
                </button>
              </div>
            </div>
          )}

          {!soloConsulta && abierta.estado === 'en_atencion' && (
            <div className="cash-form soporte-accion">
              <label className="cash-field-full">
                ¿Qué se hizo para resolverla?
                <textarea value={solucion} onChange={event => setSolucion(event.target.value)} />
              </label>
              <div className="cash-actions cash-field-full">
                <button
                  type="button"
                  className="product-primary-button"
                  disabled={procesando}
                  onClick={() => void ejecutar('resolver_incidencia', { p_solucion: solucion }, 'resuelta; falta que quien reportó confirme.')}
                >
                  Marcar como resuelta
                </button>
              </div>
            </div>
          )}

          {!soloConsulta && abierta.estado !== 'cerrada' && abierta.estado !== 'abierta' && (
            <div className="cash-form soporte-accion">
              <label className="cash-field-full">
                Agregar una nota
                <input value={nota} onChange={event => setNota(event.target.value)} placeholder="Por ejemplo: esperando repuesto" />
              </label>
              <div className="cash-actions cash-field-full">
                <button
                  type="button"
                  className="product-secondary-button"
                  disabled={procesando}
                  onClick={() => void ejecutar('agregar_nota_incidencia', { p_nota: nota }, 'nota agregada.')}
                >
                  Guardar nota
                </button>
              </div>
            </div>
          )}

          <h4 className="soporte-subtitulo">Historial</h4>
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
              <th>Número</th>
              <th>Problema</th>
              <FiltroColumna titulo="Reportó" todos="Todas las personas" valor={filtroReporto} opciones={opcionesDe(incidencias, i => i.reportado_nombre)} onCambiar={setFiltroReporto} />
              <FiltroColumna titulo="Prioridad" todos="Todas las prioridades" valor={filtroPrioridad} opciones={Object.entries(PRIORIDADES)} onCambiar={setFiltroPrioridad} />
              <FiltroColumna titulo="Estado" todos="Todos los estados" valor={filtro} opciones={OPCIONES_ESTADO} onCambiar={setFiltro} />
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr><td colSpan={7} className="inventory-empty">No hay incidencias para mostrar.</td></tr>
            )}
            {paginacion.visibles.map(incidencia => (
              <tr key={incidencia.id}>
                <td className="kardex-documento">{incidencia.numero}</td>
                <td>
                  <strong>{incidencia.descripcion}</strong>
                  <div className="soporte-celda-sub">{TIPOS_INCIDENCIA[incidencia.tipo]}{incidencia.modulo ? ` · ${incidencia.modulo}` : ''}</div>
                </td>
                <td>{incidencia.reportado_nombre ?? '—'}</td>
                <td><span className={clasePrioridad(incidencia.prioridad)}>{PRIORIDADES[incidencia.prioridad]}</span></td>
                <td><span className={claseEstadoIncidencia(incidencia.estado)}>{ESTADOS_INCIDENCIA[incidencia.estado]}</span></td>
                <td>{fechaHora(incidencia.created_at)}</td>
                <td>
                  <button type="button" className="product-edit-button" onClick={() => void abrir(incidencia)}>
                    {soloConsulta || incidencia.estado !== 'abierta' ? 'Ver' : 'Atender'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Paginador control={paginacion} />
      </div>
    </div>
  )
}
