import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import logoCasaHogar from '../assets/casa-hogar-logo-horizontal.png'


type Producto = {
  id: number
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string
  precio: number
  precio_regular: number
  descuento_porcentaje: number
  unidad_medida: string
  disponible: boolean
  pocas_unidades: boolean
  imagen_url: string | null
}

type Orden = 'destacados' | 'descuento' | 'precio'

const FILTRO_OFERTAS = 'Ofertas'

type ClienteWeb = {
  id: string
  nombre: string
  correo: string
  telefono: string | null
  direccion: string | null
  activo: boolean
}

type Pedido = {
  id: number
  numero: string
  created_at: string
  modalidad_entrega: string
  total: number
  estado: string
  direccion_entrega: string | null
  observaciones: string | null
  motivo_estado: string | null
}

type DetallePedido = {
  producto_id: number
  codigo: string
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

type Props = {
  path: string
  navigate: (path: string) => void
}

function dinero(valor: number) {
  return new Intl.NumberFormat('es-NI', {
    style: 'currency',
    currency: 'NIO',
    minimumFractionDigits: 2,
  }).format(Number(valor ?? 0))
}

function fecha(valor: string) {
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(valor))
}

function legible(valor: string) {
  return valor
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letra => letra.toUpperCase())
}


function ProductPlaceholder() {
  return (
    <div className="t-foto-vacia" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none">
        <path d="M17 20.5 32 13l15 7.5v23L32 51l-15-7.5v-23Z" />
        <path d="M17 20.5 32 28l15-7.5" />
        <path d="M32 28v23" />
        <path d="m24 17 15 7.5" />
      </svg>
    </div>
  )
}

function ProductImage({ producto }: { producto: Producto }) {
  const [fallo, setFallo] = useState(false)

  if (!producto.imagen_url || fallo) {
    return <ProductPlaceholder />
  }

  return (
    <img
      className="t-foto"
      src={producto.imagen_url}
      alt={producto.nombre}
      loading="lazy"
      onError={() => setFallo(true)}
    />
  )
}

/*
 * Ícono de línea según el nombre del departamento (categoría).
 * Las categorías vienen del catálogo interno; si no coincide
 * ninguna palabra clave se usa una caja genérica.
 */
function IconoDepartamento({ nombre }: { nombre: string }) {
  const n = nombre.toLocaleLowerCase('es')
  let trazo = 'M4 8 12 4l8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8'

  if (n.includes('herramient')) trazo = 'M4 8h9l3-3h4v6h-4l-3-3 M9 8v12'
  else if (n.includes('eléctr') || n.includes('electr')) trazo = 'M13 3 5 14h6l-1 7 8-11h-6z'
  else if (n.includes('fijac') || n.includes('tornill')) trazo = 'M9 4h6v4H9z M12 8v12 M9 11l6 2 M9 14l6 2 M9 17l6 2'
  else if (n.includes('plomer')) trazo = 'M4 10h9a3 3 0 0 1 3 3v2 M8 10V7h4 M6 7h8 M16 18v2'
  else if (n.includes('pintur')) trazo = 'M4 4h13v5H4z M17 6h3v6h-8v3 M11 15h2v6h-2z'
  else if (n.includes('constru')) trazo = 'M3 6h18v12H3z M3 12h18 M9 6v6 M15 12v6'
  else if (n.includes('jard')) trazo = 'M12 21V9 M12 9c0-3 2-5 6-5 0 4-2 6-6 6z M12 13c0-3-2-5-6-5 0 4 2 6 6 6z'

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={trazo} />
    </svg>
  )
}

function unidadLegible(unidad: string) {
  const u = unidad.trim().toLocaleLowerCase('es')
  return u ? `Por ${u}` : 'Por unidad'
}

const CLAVE_CARRITO = 'casa-hogar:carrito'

function leerCarritoGuardado(): Record<number, number> {
  try {
    const guardado = window.localStorage.getItem(CLAVE_CARRITO)
    if (!guardado) return {}

    const datos = JSON.parse(guardado) as Record<string, unknown>
    const carrito: Record<number, number> = {}

    for (const [id, cantidad] of Object.entries(datos)) {
      const numero = Number(cantidad)
      if (Number.isInteger(Number(id)) && Number.isFinite(numero) && numero > 0) {
        carrito[Number(id)] = numero
      }
    }

    return carrito
  } catch {
    return {}
  }
}

export default function Storefront({ path, navigate }: Props) {
  const [productos, setProductos] = useState<Producto[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('Todos')
  const [orden, setOrden] = useState<Orden>('destacados')
  const [cantidadesTarjeta, setCantidadesTarjeta] = useState<Record<number, number>>({})
  const [carrito, setCarrito] = useState<Record<number, number>>(leerCarritoGuardado)

  const [usuario, setUsuario] = useState<User | null>(null)
  const [cliente, setCliente] = useState<ClienteWeb | null>(null)
  const [tipoSesion, setTipoSesion] = useState('sin_sesion')
  const [pedidos, setPedidos] = useState<Pedido[]>([])

  const [modoAuth, setModoAuth] = useState<'login' | 'registro' | 'recuperar'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')

  const [nuevaClave, setNuevaClave] = useState('')
  const [confirmarClave, setConfirmarClave] = useState('')

  const [editandoPerfil, setEditandoPerfil] = useState(false)
  const [perfilNombre, setPerfilNombre] = useState('')
  const [perfilTelefono, setPerfilTelefono] = useState('')
  const [perfilDireccion, setPerfilDireccion] = useState('')

  const [pedidoAbierto, setPedidoAbierto] = useState<Pedido | null>(null)
  const [detallePedido, setDetallePedido] = useState<DetallePedido[]>([])
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const [modalidad, setModalidad] = useState<'retiro' | 'domicilio'>('retiro')
  const [direccionEntrega, setDireccionEntrega] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)

  const vista =
    path === '/tienda/login'
      ? 'login'
      : path === '/tienda/carrito'
        ? 'carrito'
        : path === '/tienda/mi-cuenta'
          ? 'cuenta'
          : path === '/tienda/restablecer'
            ? 'restablecer'
            : 'catalogo'

  async function cargarCatalogo() {
    const { data, error: rpcError } = await supabase.rpc('catalogo_publico')

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setProductos(
      (data ?? []).map((item: any) => ({
        id: Number(item.id),
        codigo: String(item.codigo ?? ''),
        nombre: String(item.nombre ?? ''),
        descripcion: item.descripcion ? String(item.descripcion) : null,
        categoria: String(item.categoria ?? 'General'),
        precio: Number(item.precio ?? 0),
        // Las columnas nuevas pueden faltar si la migración del
        // catálogo aún no se aplicó: se usa el precio final.
        precio_regular: Number(item.precio_regular ?? item.precio ?? 0),
        descuento_porcentaje: Number(item.descuento_porcentaje ?? 0),
        unidad_medida: String(item.unidad_medida ?? 'unidad'),
        disponible: Boolean(item.disponible),
        pocas_unidades: Boolean(item.pocas_unidades),
        imagen_url: item.imagen_url ? String(item.imagen_url) : null,
      })),
    )
  }

  async function cargarCliente(user: User) {
    const { data: tipoData, error: tipoError } =
      await supabase.rpc('tipo_cuenta_actual')

    if (tipoError) {
      setTipoSesion('sin_perfil')
      return
    }

    const tipo = String(tipoData ?? 'sin_perfil')
    setTipoSesion(tipo)

    if (tipo !== 'cliente_web') {
      setCliente(null)
      return
    }

    const { data, error: perfilError } =
      await supabase
        .from('clientes_web')
        .select('id,nombre,correo,telefono,direccion,activo')
        .eq('id', user.id)
        .single()

    if (perfilError) {
      setError(perfilError.message)
      return
    }

    const perfil = data as ClienteWeb
    setCliente(perfil)
    setDireccionEntrega(perfil.direccion ?? '')
    setPerfilNombre(perfil.nombre)
    setPerfilTelefono(perfil.telefono ?? '')
    setPerfilDireccion(perfil.direccion ?? '')

    await cargarPedidos()
  }

  async function cargarPedidos() {
    const { data: pedidosData } = await supabase.rpc('mis_pedidos_web')

    setPedidos(
      (pedidosData ?? []).map((item: any) => ({
        id: Number(item.id),
        numero: String(item.numero),
        created_at: String(item.created_at),
        modalidad_entrega: String(item.modalidad_entrega),
        total: Number(item.total ?? 0),
        estado: String(item.estado),
        direccion_entrega: item.direccion_entrega ?? null,
        observaciones: item.observaciones ?? null,
        motivo_estado: item.motivo_estado ?? null,
      })),
    )
  }

  useEffect(() => {
    async function iniciar() {
      setCargando(true)
      await cargarCatalogo()

      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      setUsuario(user)

      if (user) {
        await cargarCliente(user)
      }

      setCargando(false)
    }

    void iniciar()

    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((event, session) => {
        const user = session?.user ?? null
        setUsuario(user)

        // El enlace del correo de recuperación abre una sesión
        // temporal: se lleva al cliente a definir su nueva clave.
        if (event === 'PASSWORD_RECOVERY') {
          navigate('/tienda/restablecer')
        }

        if (!user) {
          setTipoSesion('sin_sesion')
          setCliente(null)
          setPedidos([])
        }
      })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (
      vista === 'cuenta' &&
      !cargando &&
      tipoSesion !== 'cliente_web'
    ) {
      navigate('/tienda/login')
    }

    // Un cliente que ya tiene sesión (por ejemplo, al volver del
    // correo de confirmación) no necesita ver el formulario.
    if (
      vista === 'login' &&
      !cargando &&
      tipoSesion === 'cliente_web'
    ) {
      navigate('/tienda/mi-cuenta')
    }
  }, [vista, cargando, tipoSesion])

  useEffect(() => {
    try {
      window.localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito))
    } catch {
      // Almacenamiento no disponible (modo privado): el carrito
      // sigue funcionando durante la visita.
    }
  }, [carrito])

  function cambiarModoAuth(modo: 'login' | 'registro' | 'recuperar') {
    setModoAuth(modo)
    setError('')
    setMensaje('')
  }

  // Departamentos = categorías del catálogo, con su cantidad de productos.
  const departamentos = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const p of productos) conteo.set(p.categoria, (conteo.get(p.categoria) ?? 0) + 1)
    return Array.from(conteo, ([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))
  }, [productos])

  const hayOfertas = productos.some(p => p.descuento_porcentaje > 0)

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es')

    const lista = productos.filter(producto => {
      const cat =
        categoria === 'Todos' ||
        (categoria === FILTRO_OFERTAS
          ? producto.descuento_porcentaje > 0
          : producto.categoria === categoria)
      const text = !q ||
        producto.nombre.toLocaleLowerCase('es').includes(q) ||
        producto.codigo.toLocaleLowerCase('es').includes(q) ||
        producto.categoria.toLocaleLowerCase('es').includes(q)

      return cat && text
    })

    // Disponibles primero en todos los órdenes.
    return lista.sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1
      if (orden === 'descuento') return b.descuento_porcentaje - a.descuento_porcentaje
      if (orden === 'precio') return a.precio - b.precio
      return 0
    })
  }, [productos, busqueda, categoria, orden])

  // Producto de la portada: el disponible con mayor descuento.
  const destacado = useMemo(
    () => [...productos]
      .filter(p => p.disponible)
      .sort((a, b) => b.descuento_porcentaje - a.descuento_porcentaje)[0] ?? null,
    [productos],
  )

  /*
   * Las dos piezas chicas de la portada muestran departamentos; si
   * el catálogo tiene menos de dos, se completan con productos
   * disponibles para que la portada no quede con huecos.
   */
  const piezasSecundarias = useMemo(() => {
    const piezas: (
      | { tipo: 'departamento'; nombre: string }
      | { tipo: 'producto'; producto: Producto }
    )[] = departamentos
      .slice(0, 2)
      .map(d => ({ tipo: 'departamento' as const, nombre: d.nombre }))

    if (departamentos.length < 2) {
      for (const producto of productos) {
        if (piezas.length >= 2) break
        if (producto.disponible && producto.id !== destacado?.id) {
          piezas.push({ tipo: 'producto', producto })
        }
      }
    }

    return piezas
  }, [departamentos, productos, destacado])

  function elegirDepartamento(nombre: string) {
    setCategoria(nombre)
    if (vista !== 'catalogo') navigate('/tienda')
    window.setTimeout(() => {
      document.getElementById('productos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  function cantidadTarjeta(id: number) {
    return cantidadesTarjeta[id] ?? 1
  }

  function cambiarCantidadTarjeta(id: number, delta: number) {
    setCantidadesTarjeta(actual => ({
      ...actual,
      [id]: Math.min(99, Math.max(1, (actual[id] ?? 1) + delta)),
    }))
  }

  const itemsCarrito = useMemo(
    () => Object.entries(carrito)
      .map(([id, cantidad]) => {
        const producto = productos.find(p => p.id === Number(id))
        return producto && cantidad > 0 ? { producto, cantidad } : null
      })
      .filter(Boolean) as { producto: Producto; cantidad: number }[],
    [carrito, productos],
  )

  const cantidadCarrito = itemsCarrito.reduce((t, i) => t + i.cantidad, 0)
  const totalCarrito = itemsCarrito.reduce(
    (t, i) => t + i.producto.precio * i.cantidad,
    0,
  )
  const totalRegular = itemsCarrito.reduce(
    (t, i) => t + Math.max(i.producto.precio_regular, i.producto.precio) * i.cantidad,
    0,
  )
  const ahorroCarrito = Math.max(0, totalRegular - totalCarrito)

  function agregar(producto: Producto, cantidad = 1) {
    if (!producto.disponible) return

    setCarrito(actual => ({
      ...actual,
      [producto.id]: (actual[producto.id] ?? 0) + cantidad,
    }))

    setCantidadesTarjeta(actual => ({ ...actual, [producto.id]: 1 }))
    setMensaje(
      cantidad > 1
        ? `${cantidad} × ${producto.nombre} agregados al carrito.`
        : `${producto.nombre} agregado al carrito.`,
    )
    setError('')
  }

  function quitar(productoId: number) {
    setCarrito(actual => {
      const copia = { ...actual }
      delete copia[productoId]
      return copia
    })
  }

  function cambiarCantidad(productoId: number, delta: number) {
    setCarrito(actual => {
      const copia = { ...actual }
      const siguiente = Math.max(0, (actual[productoId] ?? 0) + delta)

      if (siguiente === 0) delete copia[productoId]
      else copia[productoId] = siguiente

      return copia
    })
  }

  async function iniciarSesionCliente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProcesando(true)
    setError('')
    setMensaje('')

    const { data, error: loginError } =
      await supabase.auth.signInWithPassword({ email, password })

    if (loginError) {
      setError('Correo o contraseña incorrectos.')
      setProcesando(false)
      return
    }

    const { data: tipoData } = await supabase.rpc('tipo_cuenta_actual')
    const tipo = String(tipoData ?? '')

    if (tipo !== 'cliente_web') {
      await supabase.auth.signOut()
      setUsuario(null)
      setTipoSesion('sin_sesion')

      setError(
        tipo.startsWith('personal')
          ? 'Esta cuenta pertenece al sistema interno y no puede iniciar sesión en la tienda.'
          : 'Esta cuenta no está habilitada como cliente de la tienda.',
      )

      setProcesando(false)
      return
    }

    setUsuario(data.user)
    await cargarCliente(data.user)
    setPassword('')
    setProcesando(false)
    navigate('/tienda/mi-cuenta')
  }

  async function registrarCliente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMensaje('')

    // Debe coincidir con el CHECK clientes_web_nombre_check;
    // si no, Supabase solo devuelve "Database error saving new user".
    if (nombre.trim().length < 2) {
      setError('Ingresá tu nombre completo (al menos 2 caracteres).')
      return
    }

    setProcesando(true)

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Sin esto, el enlace de confirmación lleva a la raíz del
        // sitio, que redirige al login interno del personal.
        emailRedirectTo: `${window.location.origin}/tienda/login`,
        data: {
          account_type: 'cliente_web',
          full_name: nombre.trim(),
          phone: telefono.trim(),
          address: direccion.trim(),
        },
      },
    })

    if (signupError) {
      setError(signupError.message)
      setProcesando(false)
      return
    }

    if (!data.session || !data.user) {
      setMensaje('Cuenta creada. Revisa tu correo para confirmar el registro y luego inicia sesión.')
      setModoAuth('login')
      setPassword('')
      setProcesando(false)
      return
    }

    setUsuario(data.user)
    await cargarCliente(data.user)
    setProcesando(false)
    navigate('/tienda/mi-cuenta')
  }

  async function solicitarRecuperacion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProcesando(true)
    setError('')
    setMensaje('')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/tienda/restablecer` },
    )

    setProcesando(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    // Mismo mensaje exista o no la cuenta, para no revelar qué
    // correos están registrados.
    setMensaje(
      'Si el correo pertenece a una cuenta de la tienda, recibirás un enlace para restablecer tu contraseña.',
    )
  }

  async function actualizarClave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMensaje('')

    if (nuevaClave.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (nuevaClave !== confirmarClave) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setProcesando(true)

    const { error: claveError } = await supabase.auth.updateUser({
      password: nuevaClave,
    })

    setProcesando(false)

    if (claveError) {
      setError(claveError.message)
      return
    }

    setNuevaClave('')
    setConfirmarClave('')
    setMensaje('Tu contraseña fue actualizada correctamente.')
    navigate('/tienda/mi-cuenta')
  }

  async function guardarPerfil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!cliente) return

    setError('')
    setMensaje('')

    if (perfilNombre.trim().length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.')
      return
    }

    setProcesando(true)

    const { data, error: perfilError } = await supabase
      .from('clientes_web')
      .update({
        nombre: perfilNombre.trim(),
        telefono: perfilTelefono.trim() || null,
        direccion: perfilDireccion.trim() || null,
      })
      .eq('id', cliente.id)
      .select('id,nombre,correo,telefono,direccion,activo')
      .single()

    setProcesando(false)

    if (perfilError) {
      setError(perfilError.message)
      return
    }

    const perfil = data as ClienteWeb
    setCliente(perfil)
    setDireccionEntrega(perfil.direccion ?? '')
    setEditandoPerfil(false)
    setMensaje('Tus datos fueron actualizados.')
  }

  async function verPedido(pedido: Pedido) {
    if (pedidoAbierto?.id === pedido.id) {
      setPedidoAbierto(null)
      setDetallePedido([])
      return
    }

    setPedidoAbierto(pedido)
    setDetallePedido([])
    setCargandoDetalle(true)
    setError('')

    const { data, error: detalleError } = await supabase.rpc(
      'detalle_mi_pedido_web',
      { p_pedido_id: pedido.id },
    )

    setCargandoDetalle(false)

    if (detalleError) {
      setError(detalleError.message)
      return
    }

    setDetallePedido(
      (data ?? []).map((item: any) => ({
        producto_id: Number(item.producto_id),
        codigo: String(item.codigo ?? ''),
        nombre: String(item.nombre ?? ''),
        cantidad: Number(item.cantidad ?? 0),
        precio_unitario: Number(item.precio_unitario ?? 0),
        subtotal: Number(item.subtotal ?? 0),
      })),
    )
  }

  async function cancelarPedido(pedido: Pedido) {
    setProcesando(true)
    setError('')
    setMensaje('')

    const { error: cancelarError } = await supabase.rpc(
      'cancelar_mi_pedido_web',
      { p_pedido_id: pedido.id, p_motivo: null },
    )

    setProcesando(false)

    if (cancelarError) {
      setError(cancelarError.message)
      return
    }

    setMensaje(`El pedido ${pedido.numero} fue cancelado.`)
    setPedidoAbierto(null)
    setDetallePedido([])
    await cargarPedidos()
  }

  async function cerrarSesionCliente() {
    await supabase.auth.signOut()
    setUsuario(null)
    setCliente(null)
    setTipoSesion('sin_sesion')
    setPedidos([])
    setPedidoAbierto(null)
    setEditandoPerfil(false)
    navigate('/tienda')
  }

  async function confirmarPedido(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMensaje('')

    if (tipoSesion !== 'cliente_web' || !cliente) {
      navigate('/tienda/login')
      return
    }

    if (!itemsCarrito.length) {
      setError('Tu carrito está vacío.')
      return
    }

    setProcesando(true)

    const { data, error: rpcError } = await supabase.rpc('registrar_pedido_web', {
      p_items: itemsCarrito.map(item => ({
        producto_id: item.producto.id,
        cantidad: item.cantidad,
      })),
      p_modalidad_entrega: modalidad,
      p_direccion_entrega: modalidad === 'domicilio' ? direccionEntrega : null,
      p_observaciones: observaciones.trim() || null,
    })

    if (rpcError) {
      setError(rpcError.message)
      setProcesando(false)
      return
    }

    const fila = Array.isArray(data) ? data[0] : data
    setCarrito({})
    setMensaje(`Pedido ${fila?.numero ?? ''} registrado correctamente.`)
    setProcesando(false)
    await cargarCliente(usuario!)
    navigate('/tienda/mi-cuenta')
  }

  if (cargando) {
    return (
      <div className="t-cargando">
        <div className="t-cargando-anillo" />
        <span>Cargando tienda...</span>
      </div>
    )
  }

  const esCliente = tipoSesion === 'cliente_web'

  return (
    <div className="tienda">
      <div className="t-avisos">
        <span>Entrega a domicilio en Managua</span>
        <span>Retiro en tienda sin costo</span>
        <span>Existencia actualizada desde bodega</span>
      </div>

      <header className="t-cabeza">
        <div className="t-cabeza-interior">
          <button className="t-marca" type="button" onClick={() => navigate('/tienda')} aria-label="Ir al inicio de la tienda">
            <img src={logoCasaHogar} alt="Ferretería Casa Hogar" />
          </button>

          <form
            className="t-buscador"
            role="search"
            onSubmit={event => {
              event.preventDefault()
              elegirDepartamento(categoria)
            }}
          >
            <label className="t-sr" htmlFor="t-buscador-categoria">Departamento</label>
            <select
              id="t-buscador-categoria"
              value={categoria}
              onChange={event => setCategoria(event.target.value)}
            >
              <option value="Todos">Todos</option>
              {hayOfertas && <option value={FILTRO_OFERTAS}>Ofertas</option>}
              {departamentos.map(d => (
                <option key={d.nombre} value={d.nombre}>{d.nombre}</option>
              ))}
            </select>

            <label className="t-sr" htmlFor="t-buscador-texto">Buscar productos</label>
            <input
              id="t-buscador-texto"
              type="search"
              value={busqueda}
              onChange={event => setBusqueda(event.target.value)}
              placeholder="Buscar martillos, cable, tubería, pintura…"
            />

            <button type="submit">Buscar</button>
          </form>

          <div className="t-acciones">
            <button
              className="t-cuenta"
              type="button"
              onClick={() => navigate(esCliente ? '/tienda/mi-cuenta' : '/tienda/login')}
            >
              <small>{esCliente && cliente ? `Hola, ${cliente.nombre.split(' ')[0]}` : 'Hola, ingresá'}</small>
              <strong>Mi cuenta</strong>
            </button>

            <button
              className="t-carrito-boton"
              type="button"
              onClick={() => navigate('/tienda/carrito')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4h2l2.2 10h10.9l2-7H7" />
                <circle cx="9" cy="19" r="1.5" />
                <circle cx="18" cy="19" r="1.5" />
              </svg>
              <span>Carrito</span>
              <b>{cantidadCarrito}</b>
            </button>
          </div>
        </div>

        <nav className="t-departamentos" aria-label="Departamentos">
          <div className="t-departamentos-interior">
            <button
              type="button"
              className={categoria === 'Todos' ? 'is-activo' : ''}
              onClick={() => elegirDepartamento('Todos')}
            >
              Todos los productos
            </button>

            {departamentos.map(d => (
              <button
                type="button"
                key={d.nombre}
                className={categoria === d.nombre ? 'is-activo' : ''}
                onClick={() => elegirDepartamento(d.nombre)}
              >
                {d.nombre}
              </button>
            ))}

            {hayOfertas && (
              <button
                type="button"
                className={categoria === FILTRO_OFERTAS ? 't-dep-ofertas is-activo' : 't-dep-ofertas'}
                onClick={() => elegirDepartamento(FILTRO_OFERTAS)}
              >
                Ofertas de la semana
              </button>
            )}
          </div>
        </nav>
      </header>

      {vista === 'catalogo' && (
        <main className="t-contenido">
          <section className="t-portada">
            <div className="t-portada-texto">
              <span className="t-etiqueta">{hayOfertas ? 'Ofertas de la semana' : 'Pedidos en línea'}</span>
              <h1>Todo para tu obra, <em>listo para retirar</em></h1>
              <p>Armá tu pedido desde la casa o el trabajo. Lo preparamos en bodega y te avisamos cuando puedas pasar por él, o te lo llevamos.</p>
              <div className="t-botones">
                <button
                  className="t-boton t-boton--primario"
                  type="button"
                  onClick={() => elegirDepartamento(hayOfertas ? FILTRO_OFERTAS : 'Todos')}
                >
                  {hayOfertas ? 'Ver ofertas' : 'Ver productos'}
                </button>
                <button
                  className="t-boton t-boton--secundario"
                  type="button"
                  onClick={() => document.getElementById('como-comprar')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Cómo funciona el retiro
                </button>
              </div>
              <div className="t-garantias">
                <span>Precios del sistema</span>
                <span>Existencia real</span>
                <span>Pagás al retirar</span>
              </div>
            </div>

            <div className="t-collage">
              {destacado && (
                <button
                  type="button"
                  className="t-pieza t-pieza--grande"
                  onClick={() => agregar(destacado)}
                  aria-label={`Agregar ${destacado.nombre} al carrito`}
                >
                  <span className="t-precio-colgante">
                    <small>{destacado.descuento_porcentaje > 0 ? `Oferta −${destacado.descuento_porcentaje}%` : 'Destacado'}</small>
                    <b>{dinero(destacado.precio)}</b>
                  </span>
                  <ProductImage producto={destacado} />
                  <small className="t-pieza-nombre">{destacado.nombre}</small>
                </button>
              )}

              {piezasSecundarias.map(pieza =>
                pieza.tipo === 'departamento' ? (
                  <button
                    type="button"
                    key={`d-${pieza.nombre}`}
                    className="t-pieza"
                    onClick={() => elegirDepartamento(pieza.nombre)}
                  >
                    <IconoDepartamento nombre={pieza.nombre} />
                    <small className="t-pieza-nombre">{pieza.nombre}</small>
                  </button>
                ) : (
                  <button
                    type="button"
                    key={`p-${pieza.producto.id}`}
                    className="t-pieza"
                    onClick={() => agregar(pieza.producto)}
                    aria-label={`Agregar ${pieza.producto.nombre} al carrito`}
                  >
                    <ProductImage producto={pieza.producto} />
                    <small className="t-pieza-nombre">{pieza.producto.nombre}</small>
                  </button>
                ),
              )}
            </div>
          </section>

          {/* Con un solo departamento la barra superior ya alcanza */}
          {departamentos.length > 1 && (
            <section className="t-bloque" aria-labelledby="t-titulo-departamentos">
              <div className="t-bloque-cabeza">
                <div>
                  <h2 id="t-titulo-departamentos">Comprá por departamento</h2>
                  <p>Elegí un departamento para ver solo sus productos.</p>
                </div>
              </div>

              <div className="t-mosaico">
                {departamentos.map(d => (
                  <button
                    type="button"
                    key={d.nombre}
                    className={categoria === d.nombre ? 't-depto is-activo' : 't-depto'}
                    onClick={() => elegirDepartamento(d.nombre)}
                  >
                    <i><IconoDepartamento nombre={d.nombre} /></i>
                    <strong>{d.nombre}</strong>
                    <span>{d.total} producto{d.total === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="t-bloque" id="productos" aria-labelledby="t-titulo-productos">
            <div className="t-bloque-cabeza">
              <div>
                <h2 id="t-titulo-productos">
                  {categoria === 'Todos'
                    ? 'Todos los productos'
                    : categoria === FILTRO_OFERTAS
                      ? 'Ofertas de la semana'
                      : categoria}
                </h2>
                <p>
                  Mostrando {productosFiltrados.length} de {productos.length} productos
                  {busqueda.trim() ? ` para “${busqueda.trim()}”` : ''}.
                </p>
              </div>

              <div className="t-chips" role="group" aria-label="Ordenar productos">
                <button type="button" className={orden === 'destacados' ? 'is-activo' : ''} onClick={() => setOrden('destacados')}>Destacados</button>
                <button type="button" className={orden === 'descuento' ? 'is-activo' : ''} onClick={() => setOrden('descuento')}>Mayor descuento</button>
                <button type="button" className={orden === 'precio' ? 'is-activo' : ''} onClick={() => setOrden('precio')}>Menor precio</button>
              </div>
            </div>

            {error && <div className="t-aviso t-aviso--error">{error}</div>}
            {mensaje && <div className="t-aviso t-aviso--ok">{mensaje}</div>}

            <div className="t-productos">
              {productosFiltrados.map(producto => (
                <article className="t-producto" key={producto.id}>
                  <div className="t-producto-foto">
                    <ProductImage producto={producto} />
                    <span
                      className={
                        !producto.disponible
                          ? 't-stock t-stock--agotado'
                          : producto.pocas_unidades
                            ? 't-stock t-stock--bajo'
                            : 't-stock'
                      }
                    >
                      {!producto.disponible ? 'Agotado' : producto.pocas_unidades ? 'Últimas unidades' : 'Disponible'}
                    </span>
                    {producto.descuento_porcentaje > 0 && (
                      <span className="t-descuento">−{producto.descuento_porcentaje}%</span>
                    )}
                  </div>

                  <div className="t-producto-info">
                    <div className="t-producto-meta">
                      <span>{producto.categoria}</span>
                      <span className="t-sku">{producto.codigo}</span>
                    </div>
                    <h3>{producto.nombre}</h3>
                    <span className="t-unidad">{unidadLegible(producto.unidad_medida)}</span>

                    <div className="t-precio-fila">
                      <span className={producto.descuento_porcentaje > 0 ? 't-precio t-precio--oferta' : 't-precio'}>
                        {dinero(producto.precio)}
                      </span>
                      {producto.precio_regular > producto.precio && (
                        <span className="t-precio-antes">{dinero(producto.precio_regular)}</span>
                      )}
                    </div>

                    {producto.disponible ? (
                      <div className="t-comprar">
                        <div className="t-cantidad" role="group" aria-label={`Cantidad de ${producto.nombre}`}>
                          <button type="button" onClick={() => cambiarCantidadTarjeta(producto.id, -1)} aria-label="Quitar uno">−</button>
                          <span>{cantidadTarjeta(producto.id)}</span>
                          <button type="button" onClick={() => cambiarCantidadTarjeta(producto.id, 1)} aria-label="Agregar uno">+</button>
                        </div>
                        <button
                          className="t-agregar"
                          type="button"
                          onClick={() => agregar(producto, cantidadTarjeta(producto.id))}
                        >
                          Agregar
                        </button>
                      </div>
                    ) : (
                      <button className="t-agregar" type="button" disabled>Sin existencias</button>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {!productosFiltrados.length && (
              <div className="t-vacio">
                No encontramos productos con esos criterios.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setBusqueda('')
                    setCategoria('Todos')
                  }}
                >
                  Ver todos los productos
                </button>
              </div>
            )}
          </section>

          <section className="t-confianza" id="como-comprar" aria-label="Cómo comprar">
            <div>
              <i><svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg></i>
              <span><strong>Entrega a domicilio</strong>Coordinamos según tu dirección</span>
            </div>
            <div>
              <i><svg viewBox="0 0 24 24"><path d="M4 9h16l-1 11H5z" /><path d="M8 9V6a4 4 0 0 1 8 0v3" /></svg></i>
              <span><strong>Retiro en tienda</strong>Te avisamos cuando esté listo</span>
            </div>
            <div>
              <i><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg></i>
              <span><strong>Pagás en caja</strong>Efectivo, tarjeta o transferencia</span>
            </div>
            <div>
              <i><svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" /></svg></i>
              <span><strong>Existencia real</strong>Lo que ves es lo que hay en bodega</span>
            </div>
          </section>
        </main>
      )}

      {vista === 'carrito' && (
        <main className="t-contenido t-carrito">
          <div className="t-migas">
            <button type="button" onClick={() => navigate('/tienda')}>Catálogo</button>
            <span aria-hidden="true">/</span>
            <strong>Carrito</strong>
          </div>

          <div className="t-carrito-titulo">
            <h1>Tu carrito</h1>
            <ol className="t-pasos" aria-label="Pasos de compra">
              <li className="hecho"><b>✓</b>Carrito</li>
              <li className="actual"><b>2</b>Entrega</li>
              <li><b>3</b>Pedido recibido</li>
            </ol>
          </div>

          {error && <div className="t-aviso t-aviso--error">{error}</div>}

          {!itemsCarrito.length ? (
            <div className="t-vacio">
              Tu carrito está vacío.{' '}
              <button type="button" onClick={() => navigate('/tienda')}>Ver productos</button>
            </div>
          ) : (
            <div className="t-carrito-grid">
              <div className="t-lineas">
                {itemsCarrito.map(item => (
                  <article className="t-linea" key={item.producto.id}>
                    <div className="t-miniatura"><ProductImage producto={item.producto} /></div>

                    <div className="t-linea-info">
                      <h2>{item.producto.nombre}</h2>
                      <small>
                        <span className="t-sku">{item.producto.codigo}</span>
                        {' · '}
                        {dinero(item.producto.precio)} {unidadLegible(item.producto.unidad_medida).toLocaleLowerCase('es')}
                        {item.producto.descuento_porcentaje > 0 && ` · ${item.producto.descuento_porcentaje}% de descuento`}
                      </small>
                      <button className="t-quitar" type="button" onClick={() => quitar(item.producto.id)}>Quitar</button>
                    </div>

                    <div className="t-cantidad" role="group" aria-label={`Cantidad de ${item.producto.nombre}`}>
                      <button type="button" onClick={() => cambiarCantidad(item.producto.id, -1)} aria-label="Quitar uno">−</button>
                      <span>{item.cantidad}</span>
                      <button type="button" onClick={() => cambiarCantidad(item.producto.id, 1)} aria-label="Agregar uno">+</button>
                    </div>

                    <span className="t-subtotal">{dinero(item.producto.precio * item.cantidad)}</span>
                  </article>
                ))}

                <button className="t-volver" type="button" onClick={() => navigate('/tienda')}>
                  ← Seguir comprando
                </button>
              </div>

              <aside className="t-resumen">
                <h2>Resumen del pedido</h2>
                <div className="t-renglon"><span>Productos ({cantidadCarrito} unidad{cantidadCarrito === 1 ? '' : 'es'})</span><b>{dinero(totalRegular)}</b></div>
                {ahorroCarrito > 0 && (
                  <div className="t-renglon t-renglon--ahorro"><span>Descuentos</span><b>− {dinero(ahorroCarrito)}</b></div>
                )}

                {!esCliente ? (
                  <>
                    <div className="t-total"><span>Total</span><b>{dinero(totalCarrito)}</b></div>
                    <div className="t-aviso">Ingresá con tu cuenta de cliente para elegir la entrega y confirmar el pedido.</div>
                    <button className="t-confirmar" type="button" onClick={() => navigate('/tienda/login')}>
                      Ingresar para continuar
                    </button>
                  </>
                ) : (
                  <form className="t-form" onSubmit={confirmarPedido}>
                    <fieldset className="t-entrega">
                      <legend>Modalidad de entrega</legend>

                      <label className={modalidad === 'domicilio' ? 't-opcion is-activa' : 't-opcion'}>
                        <input type="radio" name="modalidad" value="domicilio" checked={modalidad === 'domicilio'} onChange={() => setModalidad('domicilio')} />
                        <span><strong>Entrega a domicilio</strong><small>Coordinamos el horario contigo</small></span>
                        <em>Managua</em>
                      </label>

                      <label className={modalidad === 'retiro' ? 't-opcion is-activa' : 't-opcion'}>
                        <input type="radio" name="modalidad" value="retiro" checked={modalidad === 'retiro'} onChange={() => setModalidad('retiro')} />
                        <span><strong>Retiro en tienda</strong><small>Te avisamos cuando esté listo</small></span>
                        <em>Gratis</em>
                      </label>
                    </fieldset>

                    {modalidad === 'domicilio' && (
                      <label>
                        Dirección de entrega
                        <textarea value={direccionEntrega} onChange={event => setDireccionEntrega(event.target.value)} required />
                      </label>
                    )}

                    <label>
                      Observaciones
                      <textarea value={observaciones} onChange={event => setObservaciones(event.target.value)} placeholder="Opcional" />
                    </label>

                    <div className="t-total"><span>Total</span><b>{dinero(totalCarrito)}</b></div>

                    <button className="t-confirmar" type="submit" disabled={procesando}>
                      {procesando ? 'Registrando pedido...' : 'Confirmar pedido'}
                    </button>
                  </form>
                )}

                <p className="t-nota">El pago se hace en caja al retirar o al recibir tu pedido.</p>
              </aside>
            </div>
          )}
        </main>
      )}

      {vista === 'login' && (
        <main className="t-contenido t-acceso">
          <div className="t-acceso-panel">
            <h1>Tu cuenta para comprar en Casa Hogar</h1>
            <ul>
              <li><i aria-hidden="true">✓</i><span><strong>Seguí tus pedidos</strong><span>Mirá si está recibido, preparado o listo para retirar.</span></span></li>
              <li><i aria-hidden="true">✓</i><span><strong>Guardamos tu dirección</strong><span>Para que la entrega a domicilio sea más rápida.</span></span></li>
              <li><i aria-hidden="true">✓</i><span><strong>Retiro sin costo</strong><span>Pasá por tu pedido cuando te avisemos.</span></span></li>
            </ul>
          </div>

          <section className="t-acceso-tarjeta">
            {tipoSesion.startsWith('personal') ? (
              <div className="t-acceso-titulo">
                <h2>Acceso no disponible</h2>
                <p>La sesión actual pertenece al sistema interno de Casa Hogar. Las cuentas del personal no pueden usar el acceso de clientes.</p>
              </div>
            ) : (
              <>
                {modoAuth !== 'recuperar' && (
                  <div className="t-pestanas" role="tablist">
                    <button type="button" role="tab" aria-selected={modoAuth === 'login'} className={modoAuth === 'login' ? 'is-activa' : ''} onClick={() => cambiarModoAuth('login')}>Ingresar</button>
                    <button type="button" role="tab" aria-selected={modoAuth === 'registro'} className={modoAuth === 'registro' ? 'is-activa' : ''} onClick={() => cambiarModoAuth('registro')}>Crear cuenta</button>
                  </div>
                )}

                <div className="t-acceso-titulo">
                  <h2>
                    {modoAuth === 'login'
                      ? 'Hola de nuevo'
                      : modoAuth === 'registro'
                        ? 'Creá tu cuenta'
                        : 'Recuperá tu contraseña'}
                  </h2>
                  <p>
                    {modoAuth === 'login'
                      ? 'Ingresá con el correo de tu cuenta de la tienda.'
                      : modoAuth === 'registro'
                        ? 'Solo te pedimos lo necesario para preparar tus pedidos.'
                        : 'Te enviaremos un enlace a tu correo para crear una contraseña nueva.'}
                  </p>
                </div>

                {modoAuth === 'recuperar' ? (
                  <form className="t-form" onSubmit={solicitarRecuperacion}>
                    <label>
                      Correo electrónico
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
                    </label>

                    {error && <div className="t-aviso t-aviso--error">{error}</div>}
                    {mensaje && <div className="t-aviso t-aviso--ok">{mensaje}</div>}

                    <button className="t-confirmar" type="submit" disabled={procesando}>
                      {procesando ? 'Enviando...' : 'Enviar enlace'}
                    </button>
                  </form>
                ) : (
                  <form className="t-form" onSubmit={modoAuth === 'login' ? iniciarSesionCliente : registrarCliente}>
                    {modoAuth === 'registro' && (
                      <>
                        <label>
                          Nombre completo
                          <input value={nombre} onChange={e => setNombre(e.target.value)} autoComplete="name" required />
                        </label>
                        <label>
                          Teléfono
                          <input value={telefono} onChange={e => setTelefono(e.target.value)} autoComplete="tel" />
                        </label>
                        <label>
                          Dirección
                          <textarea value={direccion} onChange={e => setDireccion(e.target.value)} />
                        </label>
                      </>
                    )}

                    <label>
                      Correo electrónico
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
                    </label>

                    <label>
                      Contraseña
                      <input
                        type="password"
                        minLength={6}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete={modoAuth === 'login' ? 'current-password' : 'new-password'}
                        required
                      />
                    </label>

                    {modoAuth === 'login' && (
                      <button className="t-enlace t-enlace--derecha" type="button" onClick={() => cambiarModoAuth('recuperar')}>
                        ¿Olvidaste tu contraseña?
                      </button>
                    )}

                    {error && <div className="t-aviso t-aviso--error">{error}</div>}
                    {mensaje && <div className="t-aviso t-aviso--ok">{mensaje}</div>}

                    <button className="t-confirmar" type="submit" disabled={procesando}>
                      {procesando ? 'Procesando...' : modoAuth === 'login' ? 'Ingresar' : 'Crear cuenta'}
                    </button>
                  </form>
                )}

                <div className="t-acceso-pie">
                  {modoAuth === 'recuperar' ? (
                    <button className="t-enlace" type="button" onClick={() => cambiarModoAuth('login')}>Volver a iniciar sesión</button>
                  ) : (
                    <span>¿Sos parte del personal? <a className="t-enlace" href="/login">Ingresá al sistema interno</a></span>
                  )}
                </div>
              </>
            )}
          </section>
        </main>
      )}

      {vista === 'cuenta' && cliente && (
        <main className="store-container store-secondary store-account-page">
          <div className="store-account-header store-account-header--stitch">
            <div>
              <span className="store-cart-kicker">MI CUENTA</span>
              <h1>{cliente.nombre}</h1>
              <p>{cliente.correo}</p>
            </div>

            <button className="store-secondary-button" type="button" onClick={cerrarSesionCliente}>
              Cerrar sesión
            </button>
          </div>

          {error && <div className="store-error">{error}</div>}
          {mensaje && <div className="store-message">{mensaje}</div>}

          <section className="store-account-card store-account-card--stitch">
            <div className="store-section-heading">
              <div>
                <span className="store-eyebrow store-eyebrow--dark">MIS DATOS</span>
                <h2>Datos de contacto</h2>
              </div>

              {!editandoPerfil && (
                <div className="store-account-actions">
                  <button
                    className="store-secondary-button"
                    type="button"
                    onClick={() => {
                      setPerfilNombre(cliente.nombre)
                      setPerfilTelefono(cliente.telefono ?? '')
                      setPerfilDireccion(cliente.direccion ?? '')
                      setError('')
                      setMensaje('')
                      setEditandoPerfil(true)
                    }}
                  >
                    Editar datos
                  </button>
                  <button
                    className="store-secondary-button"
                    type="button"
                    onClick={() => {
                      setError('')
                      setMensaje('')
                      navigate('/tienda/restablecer')
                    }}
                  >
                    Cambiar contraseña
                  </button>
                </div>
              )}
            </div>

            {editandoPerfil ? (
              <form className="store-form store-form--profile" onSubmit={guardarPerfil}>
                <label>
                  Nombre completo
                  <input value={perfilNombre} onChange={e => setPerfilNombre(e.target.value)} required />
                </label>
                <label>
                  Teléfono
                  <input value={perfilTelefono} onChange={e => setPerfilTelefono(e.target.value)} />
                </label>
                <label className="store-form-full">
                  Dirección
                  <textarea value={perfilDireccion} onChange={e => setPerfilDireccion(e.target.value)} />
                </label>

                <div className="store-account-actions store-form-full">
                  <button
                    className="store-secondary-button"
                    type="button"
                    disabled={procesando}
                    onClick={() => setEditandoPerfil(false)}
                  >
                    Cancelar
                  </button>
                  <button className="store-primary store-primary--small" type="submit" disabled={procesando}>
                    {procesando ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </form>
            ) : (
              <dl className="store-profile-data">
                <div>
                  <dt>Correo</dt>
                  <dd>{cliente.correo}</dd>
                </div>
                <div>
                  <dt>Teléfono</dt>
                  <dd>{cliente.telefono || 'Sin registrar'}</dd>
                </div>
                <div>
                  <dt>Dirección</dt>
                  <dd>{cliente.direccion || 'Sin registrar'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="store-account-card store-account-card--stitch">
            <div className="store-section-heading">
              <div>
                <span className="store-eyebrow store-eyebrow--dark">PEDIDOS</span>
                <h2>Mis pedidos</h2>
              </div>
            </div>

            <div className="store-orders store-orders--stitch">
              {!pedidos.length ? (
                <div className="store-empty">Todavía no tenés pedidos registrados.</div>
              ) : pedidos.map(pedido => (
                <div className="store-order-block" key={pedido.id}>
                  <button
                    type="button"
                    className={
                      pedidoAbierto?.id === pedido.id
                        ? 'store-order-row store-order-row--stitch store-order-row--button is-open'
                        : 'store-order-row store-order-row--stitch store-order-row--button'
                    }
                    onClick={() => void verPedido(pedido)}
                    aria-expanded={pedidoAbierto?.id === pedido.id}
                  >
                    <div>
                      <strong>{pedido.numero}</strong>
                      <span>{fecha(pedido.created_at)}</span>
                    </div>
                    <span>{legible(pedido.modalidad_entrega)}</span>
                    <b>{dinero(pedido.total)}</b>
                    <em>{legible(pedido.estado)}</em>
                  </button>

                  {pedidoAbierto?.id === pedido.id && (
                    <div className="store-order-detail">
                      {pedido.motivo_estado && (
                        <div className="store-error">Motivo: {pedido.motivo_estado}</div>
                      )}

                      {pedido.modalidad_entrega === 'domicilio' && pedido.direccion_entrega && (
                        <p><strong>Entrega en:</strong> {pedido.direccion_entrega}</p>
                      )}

                      {pedido.observaciones && (
                        <p><strong>Observaciones:</strong> {pedido.observaciones}</p>
                      )}

                      {cargandoDetalle ? (
                        <p>Cargando productos...</p>
                      ) : (
                        <ul className="store-order-items">
                          {detallePedido.map(item => (
                            <li key={item.producto_id}>
                              <span>
                                {item.nombre}
                                <small>{item.cantidad} × {dinero(item.precio_unitario)}</small>
                              </span>
                              <strong>{dinero(item.subtotal)}</strong>
                            </li>
                          ))}
                        </ul>
                      )}

                      {pedido.estado === 'recibido' && (
                        <button
                          className="store-secondary-button"
                          type="button"
                          disabled={procesando}
                          onClick={() => void cancelarPedido(pedido)}
                        >
                          {procesando ? 'Cancelando...' : 'Cancelar pedido'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </main>
      )}

      {vista === 'restablecer' && (
        <main className="store-auth-page store-auth-page--stitch">
          <section className="store-auth-card store-auth-card--stitch">
            <img className="store-auth-logo" src={logoCasaHogar} alt="Ferretería Casa Hogar" />

            {tipoSesion === 'cliente_web' ? (
              <>
                <div className="store-auth-heading">
                  <span className="store-client-badge"><i /> Clientes Casa Hogar</span>
                  <h1>Nueva contraseña</h1>
                  <p>Escribí la contraseña que vas a usar para ingresar a la tienda.</p>
                </div>

                <form className="store-form store-form--auth" onSubmit={actualizarClave}>
                  <label>
                    Nueva contraseña
                    <input
                      type="password"
                      minLength={6}
                      value={nuevaClave}
                      onChange={e => setNuevaClave(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </label>

                  <label>
                    Confirmar contraseña
                    <input
                      type="password"
                      minLength={6}
                      value={confirmarClave}
                      onChange={e => setConfirmarClave(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </label>

                  {error && <div className="store-error">{error}</div>}

                  <button className="store-primary store-primary--full" type="submit" disabled={procesando}>
                    {procesando ? 'Guardando...' : 'Guardar contraseña'}
                  </button>
                </form>
              </>
            ) : (
              <div className="store-portal-warning">
                <h1>Enlace no válido</h1>
                <p>
                  {tipoSesion.startsWith('personal')
                    ? 'Las cuentas del personal no se administran desde la tienda en línea.'
                    : 'El enlace para restablecer la contraseña no es válido o ya expiró. Solicitá uno nuevo.'}
                </p>
                <button
                  className="store-auth-switch"
                  type="button"
                  onClick={() => {
                    cambiarModoAuth('recuperar')
                    navigate('/tienda/login')
                  }}
                >
                  Solicitar un enlace nuevo
                </button>
              </div>
            )}

            <button className="store-back store-back--center" type="button" onClick={() => navigate('/tienda')}>
              Volver a la tienda
            </button>
          </section>
        </main>
      )}

      <footer className="t-pie">
        <div className="t-pie-interior">
          <div className="t-pie-marca">
            <img src={logoCasaHogar} alt="Ferretería Casa Hogar" />
            <p>Managua, Nicaragua. Soluciones para construir, reparar y mejorar.</p>
          </div>

          <div>
            <h2>Departamentos</h2>
            <ul>
              {departamentos.slice(0, 5).map(d => (
                <li key={d.nombre}>
                  <button type="button" onClick={() => elegirDepartamento(d.nombre)}>{d.nombre}</button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2>Tu cuenta</h2>
            <ul>
              <li><button type="button" onClick={() => navigate(esCliente ? '/tienda/mi-cuenta' : '/tienda/login')}>{esCliente ? 'Mi cuenta' : 'Ingresar'}</button></li>
              <li><button type="button" onClick={() => navigate(esCliente ? '/tienda/mi-cuenta' : '/tienda/login')}>Mis pedidos</button></li>
              <li><button type="button" onClick={() => navigate('/tienda/carrito')}>Carrito</button></li>
            </ul>
          </div>

          <div>
            <h2>Cómo comprar</h2>
            <ul>
              <li>Retiro en tienda</li>
              <li>Entrega a domicilio</li>
              <li>Pago en caja: efectivo, tarjeta o transferencia</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}
