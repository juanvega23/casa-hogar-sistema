// La base entrega como máximo 1,000 filas por consulta. Esto las pide por
// tramos hasta traerlas todas, para que una lista larga no quede cortada.

const TRAMO = 1000

type Respuesta<T> = { data: T[] | null, error: { message: string } | null }

export async function consultaCompleta<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
): Promise<Respuesta<T>> {
  const filas: T[] = []

  for (let desde = 0; ; desde += TRAMO) {
    const { data, error } = await pedir(desde, desde + TRAMO - 1)

    if (error) return { data: null, error }

    filas.push(...(data ?? []))

    if (!data || data.length < TRAMO) return { data: filas, error: null }
  }
}
