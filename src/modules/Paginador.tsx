import { useRef } from 'react'

import type { Paginacion } from '../lib/paginacion'

// Controles de página de una lista. Si todo cabe en una página, no se muestra.

export default function Paginador<T>({ control }: { control: Paginacion<T> }) {
  const raiz = useRef<HTMLDivElement>(null)

  if (control.paginas <= 1) return null

  function ir(pagina: number) {
    control.irA(pagina)

    // Vuelve al inicio de la lista, sin dejarla bajo la barra superior
    const lista = raiz.current?.parentElement

    if (lista) {
      lista.style.scrollMarginTop = '84px'
      lista.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const numero = new Intl.NumberFormat('es-NI')

  return (
    <div className="paginador" ref={raiz}>
      <span>
        {numero.format(control.desde)}–{numero.format(control.hasta)} de <b>{numero.format(control.cantidad)}</b>
      </span>

      <div>
        <button type="button" disabled={control.pagina <= 1} onClick={() => ir(control.pagina - 1)}>
          ‹ Anterior
        </button>
        <small>Página {control.pagina} de {control.paginas}</small>
        <button type="button" disabled={control.pagina >= control.paginas} onClick={() => ir(control.pagina + 1)}>
          Siguiente ›
        </button>
      </div>
    </div>
  )
}
