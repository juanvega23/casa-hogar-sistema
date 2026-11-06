import {
  useMemo,
  useState,
} from 'react'

// Divide una lista larga en páginas, para no tener que bajar y bajar.
// Si cambia la cantidad de resultados (por un filtro), vuelve a la primera.

const POR_PAGINA = 25

export type Paginacion<T> = {
  visibles: T[]
  pagina: number
  paginas: number
  cantidad: number
  desde: number
  hasta: number
  irA: (pagina: number) => void
}

export function usePaginacion<T>(lista: T[], porPagina: number = POR_PAGINA): Paginacion<T> {
  const [pagina, setPagina] = useState(1)
  const [cantidadPrevia, setCantidadPrevia] = useState(lista.length)

  if (cantidadPrevia !== lista.length) {
    setCantidadPrevia(lista.length)
    setPagina(1)
  }

  const paginas = Math.max(1, Math.ceil(lista.length / porPagina))
  const actual = Math.min(pagina, paginas)
  const inicio = (actual - 1) * porPagina

  const visibles = useMemo(
    () => lista.slice(inicio, inicio + porPagina),
    [lista, inicio, porPagina],
  )

  return {
    visibles,
    pagina: actual,
    paginas,
    cantidad: lista.length,
    desde: lista.length ? inicio + 1 : 0,
    hasta: Math.min(inicio + porPagina, lista.length),
    irA: setPagina,
  }
}
