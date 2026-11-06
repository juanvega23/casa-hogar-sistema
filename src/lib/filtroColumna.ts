// Opciones de un filtro de columna: solo los valores que de verdad hay en la lista,
// ordenados por el texto que ve el usuario.

export type OpcionColumna = [valor: string, texto: string]

export function opcionesDe<T>(
  lista: T[],
  obtener: (fila: T) => string | null,
  etiqueta: (valor: string) => string = valor => valor,
): OpcionColumna[] {
  const valores = new Set<string>()

  for (const fila of lista) {
    const valor = obtener(fila)

    if (valor) valores.add(valor)
  }

  return [...valores]
    .map((valor): OpcionColumna => [valor, etiqueta(valor)])
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))
}
