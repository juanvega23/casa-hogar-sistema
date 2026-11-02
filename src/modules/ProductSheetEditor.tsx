import { useEffect, useState, type FormEvent } from 'react'

import { supabase } from '../lib/supabase'

// Ficha del producto (Encargado de Compras: guardar_ficha_producto) y
// productos relacionados (Responsable Comercial: guardar_productos_relacionados).
// La tienda los muestra en el detalle del producto y en el carrito.

type ProductoBasico = {
  id: number
  codigo: string
  nombre: string
}

type Area = {
  id: number
  nombre: string
}

type ProductSheetEditorProps = {
  modo: 'ficha' | 'relacionados'
  producto: ProductoBasico
  catalogo: ProductoBasico[]
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
}

const MAXIMO_RELACIONADOS = 8

export function ProductSheetEditor({ modo, producto, catalogo, onCerrar, onGuardado }: ProductSheetEditorProps) {
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const [caracteristicas, setCaracteristicas] = useState('')
  const [dimensiones, setDimensiones] = useState('')
  const [modoUso, setModoUso] = useState('')
  const [areas, setAreas] = useState<Area[]>([])
  const [areasElegidas, setAreasElegidas] = useState<number[]>([])

  const [relacionados, setRelacionados] = useState<number[]>([])
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let vigente = true

    const consultas =
      modo === 'ficha'
        ? Promise.all([
            supabase.from('fichas_producto').select('caracteristicas, dimensiones, modo_uso').eq('producto_id', producto.id).maybeSingle(),
            supabase.from('areas_aplicacion').select('id, nombre').order('orden'),
            supabase.from('producto_areas').select('area_id').eq('producto_id', producto.id),
          ]).then(([ficha, listaAreas, elegidas]) => {
            if (!vigente) return
            const fallo = ficha.error ?? listaAreas.error ?? elegidas.error
            if (fallo) return setError(`No fue posible cargar la ficha: ${fallo.message}`)

            setCaracteristicas(ficha.data?.caracteristicas ?? '')
            setDimensiones(ficha.data?.dimensiones ?? '')
            setModoUso(ficha.data?.modo_uso ?? '')
            setAreas((listaAreas.data ?? []) as Area[])
            setAreasElegidas((elegidas.data ?? []).map(fila => Number(fila.area_id)))
          })
        : supabase
            .from('productos_relacionados')
            .select('relacionado_id')
            .eq('producto_id', producto.id)
            .order('orden')
            .then(({ data, error: consultaError }) => {
              if (!vigente) return
              if (consultaError) return setError(`No fue posible cargar los relacionados: ${consultaError.message}`)
              setRelacionados((data ?? []).map(fila => Number(fila.relacionado_id)))
            })

    void Promise.resolve(consultas).then(() => {
      if (vigente) setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [modo, producto.id])

  function alternarArea(id: number) {
    setAreasElegidas(actual => (actual.includes(id) ? actual.filter(a => a !== id) : [...actual, id]))
  }

  function agregarRelacionado(id: number) {
    setError('')
    if (relacionados.length >= MAXIMO_RELACIONADOS) {
      setError(`Elegí como máximo ${MAXIMO_RELACIONADOS} productos relacionados.`)
      return
    }
    setRelacionados(actual => (actual.includes(id) ? actual : [...actual, id]))
    setBusqueda('')
  }

  function moverRelacionado(indice: number, direccion: -1 | 1) {
    setRelacionados(actual => {
      const destino = indice + direccion
      if (destino < 0 || destino >= actual.length) return actual
      const copia = [...actual]
      ;[copia[indice], copia[destino]] = [copia[destino], copia[indice]]
      return copia
    })
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setGuardando(true)

    const { error: rpcError } =
      modo === 'ficha'
        ? await supabase.rpc('guardar_ficha_producto', {
            p_producto_id: producto.id,
            p_caracteristicas: caracteristicas,
            p_dimensiones: dimensiones,
            p_modo_uso: modoUso,
            p_areas: areasElegidas,
          })
        : await supabase.rpc('guardar_productos_relacionados', {
            p_producto_id: producto.id,
            p_relacionados: relacionados,
          })

    setGuardando(false)

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    onGuardado(
      modo === 'ficha'
        ? `Ficha de ${producto.nombre} guardada. Ya se ve en la tienda.`
        : `Productos relacionados de ${producto.nombre} guardados.`,
    )
  }

  const porId = new Map(catalogo.map(p => [p.id, p]))
  const texto = busqueda.trim().toLocaleLowerCase('es')
  const resultados = texto
    ? catalogo
        .filter(p => p.id !== producto.id && !relacionados.includes(p.id))
        .filter(p => p.nombre.toLocaleLowerCase('es').includes(texto) || p.codigo.toLocaleLowerCase('es').includes(texto))
        .slice(0, 8)
    : []

  return (
    <section className="product-form-card">
      <div className="product-form-head">
        <div>
          <span className="panel-label">
            {modo === 'ficha' ? 'FICHA DEL PRODUCTO' : 'PRODUCTOS RELACIONADOS'}
          </span>
          <h3>{producto.nombre}</h3>
          <p>
            {producto.codigo} ·{' '}
            {modo === 'ficha'
              ? 'Lo que el cliente ve en la tienda al abrir el producto.'
              : 'Complementos que la tienda sugiere en el detalle del producto y en el carrito.'}
          </p>
        </div>
        <button type="button" className="product-close-button" onClick={onCerrar}>
          ×
        </button>
      </div>

      {cargando ? (
        <p className="ficha-cargando">Cargando...</p>
      ) : (
        <form className="product-form" onSubmit={guardar}>
          {modo === 'ficha' ? (
            <>
              <div className="product-field product-field--double">
                <label htmlFor="ficha-caracteristicas">Características</label>
                <textarea
                  id="ficha-caracteristicas"
                  rows={4}
                  value={caracteristicas}
                  onChange={event => setCaracteristicas(event.target.value)}
                  placeholder={'Una por línea, por ejemplo:\nAcero al carbono templado\nMango antideslizante'}
                  maxLength={2000}
                />
              </div>

              <div className="product-field">
                <label htmlFor="ficha-dimensiones">Medidas</label>
                <textarea
                  id="ficha-dimensiones"
                  rows={4}
                  value={dimensiones}
                  onChange={event => setDimensiones(event.target.value)}
                  placeholder={'Una por línea:\nLargo: 25 cm\nPeso: 300 g'}
                  maxLength={1000}
                />
                <small>Con "Nombre: valor" la tienda las muestra como tabla.</small>
              </div>

              <div className="product-field">
                <label htmlFor="ficha-uso">Modo de uso</label>
                <textarea
                  id="ficha-uso"
                  rows={4}
                  value={modoUso}
                  onChange={event => setModoUso(event.target.value)}
                  placeholder="Cómo se usa y recomendaciones de seguridad"
                  maxLength={2000}
                />
              </div>

              <fieldset className="product-field product-field--double ficha-areas">
                <legend>Áreas de aplicación</legend>
                <div>
                  {areas.map(area => (
                    <label key={area.id} className={areasElegidas.includes(area.id) ? 'is-activa' : ''}>
                      <input
                        type="checkbox"
                        checked={areasElegidas.includes(area.id)}
                        onChange={() => alternarArea(area.id)}
                      />
                      {area.nombre}
                    </label>
                  ))}
                </div>
                <small>El cliente puede filtrar el catálogo por área.</small>
              </fieldset>
            </>
          ) : (
            <div className="product-field product-field--double ficha-relacionados">
              <label htmlFor="relacionados-buscar">Agregar producto</label>
              <input
                id="relacionados-buscar"
                type="search"
                value={busqueda}
                onChange={event => setBusqueda(event.target.value)}
                placeholder="Buscar por nombre o código"
                autoComplete="off"
              />

              {resultados.length > 0 && (
                <ul className="ficha-resultados">
                  {resultados.map(p => (
                    <li key={p.id}>
                      <button type="button" onClick={() => agregarRelacionado(p.id)}>
                        <span className="ficha-codigo">{p.codigo}</span>
                        {p.nombre}
                        <b>+ Agregar</b>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <span className="ficha-subtitulo">
                Elegidos ({relacionados.length} de {MAXIMO_RELACIONADOS}) — en este orden se muestran
              </span>

              {relacionados.length === 0 ? (
                <small>Todavía no hay productos relacionados.</small>
              ) : (
                <ol className="ficha-elegidos">
                  {relacionados.map((id, indice) => {
                    const p = porId.get(id)
                    return (
                      <li key={id}>
                        <span>
                          <span className="ficha-codigo">{p?.codigo ?? '—'}</span>
                          {p?.nombre ?? 'Producto no disponible'}
                        </span>
                        <span className="ficha-mover">
                          <button type="button" onClick={() => moverRelacionado(indice, -1)} disabled={indice === 0} aria-label="Subir">↑</button>
                          <button type="button" onClick={() => moverRelacionado(indice, 1)} disabled={indice === relacionados.length - 1} aria-label="Bajar">↓</button>
                          <button type="button" onClick={() => setRelacionados(actual => actual.filter(r => r !== id))} aria-label="Quitar">×</button>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )}

          {error && <div className="inventory-error product-field--double">{error}</div>}

          <div className="product-form-actions">
            <button type="button" className="product-secondary-button" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </button>
            <button type="submit" className="product-primary-button" disabled={guardando}>
              {guardando ? 'Guardando...' : modo === 'ficha' ? 'Guardar ficha' : 'Guardar relacionados'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
