import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'

import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import logoCasaHogar from '../assets/casa-hogar-logo.png'


type Producto = {
  id: number
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string
  precio: number
  disponible: boolean
  imagen_url: string | null
}

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


function ProductPlaceholder({ codigo }: { codigo: string }) {
  return (
    <div className="store-product-placeholder" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none">
        <path d="M17 20.5 32 13l15 7.5v23L32 51l-15-7.5v-23Z" />
        <path d="M17 20.5 32 28l15-7.5" />
        <path d="M32 28v23" />
        <path d="m24 17 15 7.5" />
        <path d="M42.5 34.5a7 7 0 0 0-8.8 8.8l-7.2 7.2 4 4 7.2-7.2a7 7 0 0 0 8.8-8.8l-4 4-4-4 4-4Z" />
      </svg>
      <strong>Imagen de producto</strong>
      <span>{codigo}</span>
    </div>
  )
}

function ProductImage({ producto }: { producto: Producto }) {
  const [fallo, setFallo] = useState(false)

  if (!producto.imagen_url || fallo) {
    return <ProductPlaceholder codigo={producto.codigo} />
  }

  return (
    <img
      className="store-product-image"
      src={producto.imagen_url}
      alt={producto.nombre}
      loading="lazy"
      onError={() => setFallo(true)}
    />
  )
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
        disponible: Boolean(item.disponible),
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

  const categorias = useMemo(
    () => ['Todos', ...Array.from(new Set(productos.map(p => p.categoria)))],
    [productos],
  )

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es')

    return productos.filter(producto => {
      const cat = categoria === 'Todos' || producto.categoria === categoria
      const text = !q ||
        producto.nombre.toLocaleLowerCase('es').includes(q) ||
        producto.codigo.toLocaleLowerCase('es').includes(q)

      return cat && text
    })
  }, [productos, busqueda, categoria])

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

  function agregar(producto: Producto) {
    if (!producto.disponible) return

    setCarrito(actual => ({
      ...actual,
      [producto.id]: (actual[producto.id] ?? 0) + 1,
    }))

    setMensaje(`${producto.nombre} agregado al carrito.`)
    setError('')
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
      <div className="store-loading store-loading--stitch">
        <div className="store-loading-ring" />
        <span>Cargando tienda...</span>
      </div>
    )
  }

  return (
    <div className="store-page store-page--stitch">
      <header className="store-header store-header--stitch">
        <div className="store-header-main">
          <button
            className="store-brand store-brand--stitch"
            type="button"
            onClick={() => navigate('/tienda')}
          >
            <img src={logoCasaHogar} alt="Ferretería Casa Hogar" />
            <div>
              <strong>Casa Hogar</strong>
              <span>Ferretería</span>
            </div>
          </button>

          <div className="store-global-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar herramientas, materiales, productos..."
              aria-label="Buscar productos"
            />
          </div>

          <nav className="store-nav store-nav--stitch">
            <button
              type="button"
              onClick={() =>
                tipoSesion === 'cliente_web'
                  ? navigate('/tienda/mi-cuenta')
                  : navigate('/tienda/login')
              }
            >
              {tipoSesion === 'cliente_web' ? 'Mi cuenta' : 'Ingresar'}
            </button>

            <button
              type="button"
              className="store-cart-button store-cart-button--stitch"
              onClick={() => navigate('/tienda/carrito')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4h2l2.2 10h10.9l2-7H7" />
                <circle cx="9" cy="19" r="1.5" />
                <circle cx="18" cy="19" r="1.5" />
              </svg>
              <span className="store-cart-label">Carrito</span>
              <span className="store-cart-count">{cantidadCarrito}</span>
            </button>
          </nav>
        </div>

      </header>

      {vista === 'catalogo' && (
        <main className="store-catalog-shell">
          <section className="store-service-strip">
            <article>
              <span className="store-service-icon">↗</span>
              <div>
                <strong>Entrega a domicilio</strong>
                <span>Prepará tu pedido desde la tienda en línea.</span>
              </div>
            </article>
            <article>
              <span className="store-service-icon">▣</span>
              <div>
                <strong>Retiro en tienda</strong>
                <span>Seleccioná retiro al confirmar tu pedido.</span>
              </div>
            </article>
            <article>
              <span className="store-service-icon">✓</span>
              <div>
                <strong>Disponibilidad actual</strong>
                <span>Consultá el estado de cada producto.</span>
              </div>
            </article>
          </section>

          <section className="store-filter-panel">
            <div className="store-filter-copy">
              <span>Catálogo</span>
              <strong>Productos disponibles</strong>
            </div>

            <div className="store-filter-categories">
              {categorias.map(item => (
                <button
                  type="button"
                  key={item}
                  className={item === categoria ? 'is-active' : ''}
                  onClick={() => setCategoria(item)}
                >
                  {item === 'Todos' ? 'Todos' : item}
                </button>
              ))}
            </div>

            <div className="store-filter-count">
              <i />
              Mostrando {productosFiltrados.length} de {productos.length} productos
            </div>
          </section>

          {error && <div className="store-error">{error}</div>}
          {mensaje && <div className="store-message">{mensaje}</div>}

          <section className="store-product-grid store-product-grid--stitch">
            {productosFiltrados.map(producto => (
              <article className="store-product-card store-product-card--stitch" key={producto.id}>
                <div className="store-product-media">
                  <ProductImage producto={producto} />
                  <span
                    className={
                      producto.disponible
                        ? 'store-stock-badge store-stock-badge--ok'
                        : 'store-stock-badge store-stock-badge--out'
                    }
                  >
                    <i />
                    {producto.disponible ? 'Disponible' : 'Agotado'}
                  </span>
                </div>

                <div className="store-product-body store-product-body--stitch">
                  <div className="store-product-head store-product-head--stitch">
                    <span className="store-product-category">{producto.categoria}</span>
                    <code>{producto.codigo}</code>
                  </div>

                  <h3>{producto.nombre}</h3>

                  {producto.descripcion && (
                    <p className="store-product-description">{producto.descripcion}</p>
                  )}

                  <div className="store-product-price">
                    <strong>{dinero(producto.precio)}</strong>
                  </div>

                  <button
                    type="button"
                    className="store-primary store-primary--product"
                    disabled={!producto.disponible}
                    onClick={() => agregar(producto)}
                  >
                    <span aria-hidden="true">＋</span>
                    {producto.disponible ? 'Agregar al carrito' : 'Sin existencias'}
                  </button>
                </div>
              </article>
            ))}
          </section>

          {!productosFiltrados.length && (
            <div className="store-empty store-empty--catalog">
              No encontramos productos con esos criterios.
            </div>
          )}
        </main>
      )}

      {vista === 'carrito' && (
        <main className="store-container store-secondary store-cart-page">
          <div className="store-breadcrumbs">
            <button type="button" onClick={() => navigate('/tienda')}>Catálogo</button>
            <span>›</span>
            <strong>Carrito de compras</strong>
          </div>

          <div className="store-cart-title-row">
            <div>
              <span className="store-cart-kicker">ORDEN EN CURSO</span>
              <h1>Tu Carrito de Compras</h1>
            </div>
            <span>{itemsCarrito.length} líneas · {cantidadCarrito} unidades</span>
          </div>

          <div className="store-checkout-layout store-checkout-layout--stitch">
            <section className="store-cart-list store-cart-list--stitch">
              {!itemsCarrito.length ? (
                <div className="store-empty">Tu carrito está vacío.</div>
              ) : itemsCarrito.map(item => (
                <article className="store-cart-item store-cart-item--stitch" key={item.producto.id}>
                  <div className="store-cart-thumb">
                    <ProductImage producto={item.producto} />
                  </div>

                  <div className="store-cart-product-copy">
                    <span>{item.producto.categoria} · SKU: {item.producto.codigo}</span>
                    <h3>{item.producto.nombre}</h3>
                    <p>Precio unitario: <strong>{dinero(item.producto.precio)}</strong></p>
                  </div>

                  <div className="store-quantity store-quantity--stitch">
                    <button type="button" onClick={() => cambiarCantidad(item.producto.id, -1)}>−</button>
                    <strong>{item.cantidad}</strong>
                    <button type="button" onClick={() => cambiarCantidad(item.producto.id, 1)}>+</button>
                  </div>

                  <div className="store-cart-subtotal">
                    <span>Subtotal</span>
                    <strong>{dinero(item.producto.precio * item.cantidad)}</strong>
                  </div>
                </article>
              ))}

              <button className="store-back store-back--stitch" type="button" onClick={() => navigate('/tienda')}>
                ← Seguir comprando en el catálogo
              </button>

              <div className="store-cart-benefits">
                <article><strong>Compra registrada</strong><span>Tu pedido queda asociado a tu cuenta.</span></article>
                <article><strong>Stock actualizado</strong><span>Trabajamos con la disponibilidad del sistema.</span></article>
                <article><strong>Dos modalidades</strong><span>Retiro en tienda o entrega a domicilio.</span></article>
              </div>
            </section>

            <aside className="store-order-summary store-order-summary--stitch">
              <div className="store-summary-title">
                <h2>Resumen del pedido</h2>
              </div>

              <div className="store-summary-subtotal">
                <span>Subtotal productos ({cantidadCarrito} artículos)</span>
                <strong>{dinero(totalCarrito)}</strong>
              </div>

              {tipoSesion !== 'cliente_web' ? (
                <>
                  <div className="store-login-required">
                    <strong>Iniciá sesión para continuar</strong>
                    <p>Necesitás una cuenta de cliente para confirmar el pedido.</p>
                  </div>
                  <button
                    className="store-primary store-primary--full"
                    type="button"
                    disabled={!itemsCarrito.length}
                    onClick={() => navigate('/tienda/login')}
                  >
                    Iniciar sesión para continuar
                  </button>
                </>
              ) : (
                <form className="store-form store-form--checkout" onSubmit={confirmarPedido}>
                  <fieldset className="store-delivery-options">
                    <legend>Modalidad de entrega</legend>

                    <label className={modalidad === 'retiro' ? 'is-selected' : ''}>
                      <input
                        type="radio"
                        name="modalidad"
                        value="retiro"
                        checked={modalidad === 'retiro'}
                        onChange={() => setModalidad('retiro')}
                      />
                      <div><strong>Retiro en tienda</strong><span>Retirá tu pedido directamente.</span></div>
                    </label>

                    <label className={modalidad === 'domicilio' ? 'is-selected' : ''}>
                      <input
                        type="radio"
                        name="modalidad"
                        value="domicilio"
                        checked={modalidad === 'domicilio'}
                        onChange={() => setModalidad('domicilio')}
                      />
                      <div><strong>Entrega a domicilio</strong><span>Coordinación según dirección de entrega.</span></div>
                    </label>
                  </fieldset>

                  {modalidad === 'domicilio' && (
                    <label>
                      Dirección de entrega
                      <textarea value={direccionEntrega} onChange={e => setDireccionEntrega(e.target.value)} required />
                    </label>
                  )}

                  <label>
                    Observaciones
                    <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional" />
                  </label>

                  {error && <div className="store-error">{error}</div>}

                  <div className="store-total-line store-total-line--stitch">
                    <span>Total a pagar</span>
                    <strong>{dinero(totalCarrito)}</strong>
                  </div>

                  <button className="store-primary store-primary--full" type="submit" disabled={procesando || !itemsCarrito.length}>
                    {procesando ? 'Registrando...' : 'Confirmar pedido →'}
                  </button>
                </form>
              )}
            </aside>
          </div>
        </main>
      )}

      {vista === 'login' && (
        <main className="store-auth-page store-auth-page--stitch">
          <section className="store-auth-card store-auth-card--stitch">
            <img className="store-auth-logo" src={logoCasaHogar} alt="Ferretería Casa Hogar" />

            {tipoSesion.startsWith('personal') ? (
              <div className="store-portal-warning">
                <h1>Acceso no disponible</h1>
                <p>
                  La sesión actual pertenece al sistema interno de Casa Hogar.
                  Las cuentas del personal no pueden utilizar el acceso de clientes.
                </p>
              </div>
            ) : (
              <>
                <div className="store-auth-heading">
                  <span className="store-client-badge"><i /> Clientes Casa Hogar</span>
                  <h1>
                    {modoAuth === 'login'
                      ? 'Ingresá a tu cuenta'
                      : modoAuth === 'registro'
                        ? 'Creá tu cuenta'
                        : 'Recuperá tu contraseña'}
                  </h1>
                  <p>
                    {modoAuth === 'recuperar'
                      ? 'Te enviaremos un enlace a tu correo para crear una contraseña nueva.'
                      : 'Acceso exclusivo para compras y pedidos de la tienda en línea.'}
                  </p>
                </div>

                {modoAuth === 'recuperar' ? (
                  <form className="store-form store-form--auth" onSubmit={solicitarRecuperacion}>
                    <label>
                      Correo electrónico
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </label>

                    {error && <div className="store-error">{error}</div>}
                    {mensaje && <div className="store-message">{mensaje}</div>}

                    <button className="store-primary store-primary--full" type="submit" disabled={procesando}>
                      {procesando ? 'Enviando...' : 'Enviar enlace'}
                    </button>
                  </form>
                ) : (
                <form className="store-form store-form--auth" onSubmit={modoAuth === 'login' ? iniciarSesionCliente : registrarCliente}>
                  {modoAuth === 'registro' && (
                    <>
                      <label>
                        Nombre completo
                        <input value={nombre} onChange={e => setNombre(e.target.value)} required />
                      </label>
                      <label>
                        Teléfono
                        <input value={telefono} onChange={e => setTelefono(e.target.value)} />
                      </label>
                      <label>
                        Dirección
                        <textarea value={direccion} onChange={e => setDireccion(e.target.value)} />
                      </label>
                    </>
                  )}

                  <label>
                    Correo electrónico
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                  </label>

                  <label>
                    Contraseña
                    <input type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required />
                  </label>

                  {error && <div className="store-error">{error}</div>}
                  {mensaje && <div className="store-message">{mensaje}</div>}

                  <button className="store-primary store-primary--full" type="submit" disabled={procesando}>
                    {procesando
                      ? 'Procesando...'
                      : modoAuth === 'login'
                        ? 'Iniciar sesión'
                        : 'Crear cuenta'}
                  </button>
                </form>
                )}

                {modoAuth === 'login' && (
                  <button
                    className="store-auth-switch"
                    type="button"
                    onClick={() => cambiarModoAuth('recuperar')}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                )}

                <button
                  className="store-auth-switch"
                  type="button"
                  onClick={() => cambiarModoAuth(modoAuth === 'registro' ? 'login' : modoAuth === 'login' ? 'registro' : 'login')}
                >
                  {modoAuth === 'login'
                    ? '¿No tenés cuenta? Registrate'
                    : modoAuth === 'registro'
                      ? '¿Ya tenés cuenta? Iniciá sesión'
                      : 'Volver a iniciar sesión'}
                </button>
              </>
            )}

            <button className="store-back store-back--center" type="button" onClick={() => navigate('/tienda')}>
              Volver a la tienda
            </button>
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

      <footer className="store-footer store-footer--stitch">
        <div className="store-footer-inner">
          <div className="store-footer-brand">
            <img src={logoCasaHogar} alt="" aria-hidden="true" />
            <div>
              <strong>Ferretería Casa Hogar</strong>
              <span>Soluciones para construir, reparar y mejorar.</span>
            </div>
          </div>

          <div className="store-footer-note">
            Catálogo y pedidos en línea
          </div>
        </div>
      </footer>
    </div>
  )
}
