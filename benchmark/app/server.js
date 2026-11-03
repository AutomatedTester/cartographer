import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// In-memory data (deterministic — same data every run, critical for benchmarking)
// ---------------------------------------------------------------------------

const USERS = [
  { username: 'admin',  password: 'password123', name: 'Admin User', email: 'admin@benchmark.test' },
  { username: 'demo',   password: 'demo123',     name: 'Demo User',  email: 'demo@benchmark.test'  },
];

const PRODUCTS = [
  { id: 1, name: 'Laptop Pro 15',       price: 1299.00, category: 'computers',   description: 'High-performance laptop with 15-inch display, 16GB RAM, and 512GB SSD.',              inStock: true,  image: '💻' },
  { id: 2, name: 'Wireless Mouse',      price:   29.99, category: 'accessories', description: 'Ergonomic wireless mouse with 2.4GHz connectivity and 12-month battery life.',        inStock: true,  image: '🖱️' },
  { id: 3, name: 'USB-C Hub 7-in-1',   price:   49.99, category: 'accessories', description: 'Multi-port USB-C hub with HDMI, USB-A, SD card reader, and power delivery.',          inStock: true,  image: '🔌' },
  { id: 4, name: 'Monitor 27"',         price:  399.00, category: 'monitors',    description: '27-inch 4K IPS display with 144Hz refresh rate and HDR support.',                     inStock: true,  image: '🖥️' },
  { id: 5, name: 'Mechanical Keyboard', price:  129.00, category: 'accessories', description: 'Tenkeyless mechanical keyboard with Cherry MX switches and RGB backlight.',           inStock: true,  image: '⌨️' },
  { id: 6, name: 'Webcam HD 1080p',     price:   79.99, category: 'accessories', description: '1080p webcam with built-in microphone and auto-focus. Great for video calls.',        inStock: false, image: '📷' },
];

const DEALS = [
  { id: 1, title: '20% off all accessories', code: 'ACC20',   expires: '2026-12-31', saving: 'Save up to $26' },
  { id: 2, title: 'Free shipping on orders over $100', code: 'SHIP100', expires: '2026-06-30', saving: 'Save $9.99' },
  { id: 3, title: '$50 off monitors',        code: 'MON50',   expires: '2026-09-30', saving: 'Save $50' },
];

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'benchmark-deterministic-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60 * 60 * 1000 },
}));

// Inject shared locals into every template render
app.use((req, res, next) => {
  res.locals.user      = req.session.user || null;
  res.locals.cartCount = (req.session.cart || []).reduce((sum, i) => sum + i.quantity, 0);
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login?next=' + encodeURIComponent(req.path));
  next();
}

// ---------------------------------------------------------------------------
// Routes — Journey 1: Homepage + Navigation
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.render('index', {
    title: 'BenchmarkShop',
    featuredProducts: PRODUCTS.filter(p => p.inStock).slice(0, 3),
    deals: DEALS.slice(0, 2),
  });
});

app.get('/about',   (req, res) => res.render('about',   { title: 'About Us' }));
app.get('/deals',   (req, res) => res.render('deals',   { title: 'Current Deals', deals: DEALS }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Contact Us', success: false, error: null }));

// Fixture for the ARIA advisory. Not linked from any page, so crawls never reach it.
app.get('/aria-lab', (req, res) => res.render('aria-lab', { title: 'ARIA Lab' }));

app.post('/contact', (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.render('contact', { title: 'Contact Us', success: false, error: 'All fields are required.' });
  }
  res.render('contact', { title: 'Contact Us', success: true, error: null });
});

// ---------------------------------------------------------------------------
// Routes — Journey 2: Login flow
// ---------------------------------------------------------------------------

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign In', error: null, next: req.query.next || '/dashboard' });
});

app.post('/login', (req, res) => {
  const { username, password, next } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.render('login', { title: 'Sign In', error: 'Invalid username or password.', next: next || '/dashboard' });
  }
  req.session.user = { username: user.username, name: user.name, email: user.email };
  res.redirect(next || '/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard',
    recentOrders: req.session.orders || [],
  });
});

// ---------------------------------------------------------------------------
// Routes — Journey 3: Multi-step registration
// ---------------------------------------------------------------------------

app.get('/register', (req, res) => {
  req.session.registration = {};
  res.render('register-step1', { title: 'Create Account — Step 1 of 3', error: null });
});

app.post('/register', (req, res) => {
  const { firstName, lastName, email } = req.body;
  if (!firstName || !lastName || !email) {
    return res.render('register-step1', { title: 'Create Account — Step 1 of 3', error: 'All fields are required.' });
  }
  req.session.registration = { firstName, lastName, email };
  res.redirect('/register/step2');
});

app.get('/register/step2', (req, res) => {
  if (!req.session.registration?.email) return res.redirect('/register');
  res.render('register-step2', { title: 'Create Account — Step 2 of 3', error: null });
});

app.post('/register/step2', (req, res) => {
  const { address, city, country, zip } = req.body;
  if (!address || !city || !country || !zip) {
    return res.render('register-step2', { title: 'Create Account — Step 2 of 3', error: 'All fields are required.' });
  }
  req.session.registration = { ...req.session.registration, address, city, country, zip };
  res.redirect('/register/step3');
});

app.get('/register/step3', (req, res) => {
  if (!req.session.registration?.city) return res.redirect('/register/step2');
  res.render('register-step3', { title: 'Create Account — Step 3 of 3', error: null });
});

app.post('/register/step3', (req, res) => {
  const { newsletter, notifications, password } = req.body;
  if (!password) {
    return res.render('register-step3', { title: 'Create Account — Step 3 of 3', error: 'Password is required.' });
  }
  req.session.registration = {
    ...req.session.registration,
    newsletter: !!newsletter,
    notifications: !!notifications,
    complete: true,
  };
  res.redirect('/register/complete');
});

app.get('/register/complete', (req, res) => {
  if (!req.session.registration?.complete) return res.redirect('/register');
  const registration = req.session.registration;
  req.session.registration = null;
  res.render('register-complete', { title: 'Account Created', registration });
});

// ---------------------------------------------------------------------------
// Routes — Journey 4: Product browse → cart → checkout
// ---------------------------------------------------------------------------

app.get('/products', (req, res) => {
  const { category, q } = req.query;
  let filtered = [...PRODUCTS];
  if (category) filtered = filtered.filter(p => p.category === category);
  if (q)        filtered = filtered.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.description.toLowerCase().includes(q.toLowerCase())
  );
  const categories = [...new Set(PRODUCTS.map(p => p.category))];
  res.render('products', {
    title: 'Products',
    products: filtered,
    categories,
    activeCategory: category || null,
    query: q || '',
  });
});

app.get('/products/:id', (req, res) => {
  const product = PRODUCTS.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).render('404', { title: 'Not Found' });
  res.render('product-detail', { title: product.name, product });
});

app.get('/cart', (req, res) => {
  const cart  = req.session.cart || [];
  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  res.render('cart', { title: 'Your Cart', cart, total: total.toFixed(2) });
});

app.post('/cart/add', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const product = PRODUCTS.find(p => p.id === parseInt(productId));
  if (!product || !product.inStock) return res.redirect('/products');

  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.productId === product.id);
  if (existing) {
    existing.quantity += parseInt(quantity);
  } else {
    req.session.cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: parseInt(quantity),
      image: product.image,
    });
  }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const { productId } = req.body;
  req.session.cart = (req.session.cart || []).filter(i => i.productId !== parseInt(productId));
  res.redirect('/cart');
});

// Checkout step 1 — shipping
app.get('/checkout', (req, res) => {
  if (!(req.session.cart || []).length) return res.redirect('/cart');
  res.render('checkout-shipping', { title: 'Checkout — Shipping', error: null });
});

app.post('/checkout', (req, res) => {
  const { firstName, lastName, address, city, country, zip } = req.body;
  if (!firstName || !lastName || !address || !city || !country || !zip) {
    return res.render('checkout-shipping', { title: 'Checkout — Shipping', error: 'All fields are required.' });
  }
  req.session.checkoutShipping = { firstName, lastName, address, city, country, zip };
  res.redirect('/checkout/payment');
});

// Checkout step 2 — payment
app.get('/checkout/payment', (req, res) => {
  if (!req.session.checkoutShipping) return res.redirect('/checkout');
  res.render('checkout-payment', { title: 'Checkout — Payment', error: null });
});

app.post('/checkout/payment', (req, res) => {
  const { cardNumber, cardExpiry, cardCvv, cardName } = req.body;
  if (!cardNumber || !cardExpiry || !cardCvv || !cardName) {
    return res.render('checkout-payment', { title: 'Checkout — Payment', error: 'All payment fields are required.' });
  }
  const cart  = req.session.cart || [];
  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const order = {
    orderNumber: 'ORD-' + Date.now().toString(36).toUpperCase(),
    items: cart,
    total: total.toFixed(2),
    shipping: req.session.checkoutShipping,
    date: new Date().toISOString(),
  };
  if (!req.session.orders) req.session.orders = [];
  req.session.orders.unshift(order);
  req.session.lastOrder   = order;
  req.session.cart        = [];
  req.session.checkoutShipping = null;
  res.redirect('/checkout/confirm');
});

// Checkout step 3 — confirmation
app.get('/checkout/confirm', (req, res) => {
  if (!req.session.lastOrder) return res.redirect('/');
  const order = req.session.lastOrder;
  req.session.lastOrder = null;
  res.render('checkout-confirm', { title: 'Order Confirmed', order });
});

// ---------------------------------------------------------------------------
// Routes — Journey 5: Search → results → product detail
// ---------------------------------------------------------------------------

app.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) return res.redirect('/products');
  const results = PRODUCTS.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.description.toLowerCase().includes(q.toLowerCase()) ||
    p.category.toLowerCase().includes(q.toLowerCase())
  );
  res.render('search-results', { title: `Search: "${q}"`, results, query: q });
});

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------

app.use((req, res) => res.status(404).render('404', { title: 'Page Not Found' }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\nBenchmarkShop running at http://localhost:${PORT}`);
  console.log('─'.repeat(45));
  console.log('Credentials: admin / password123   demo / demo123');
  console.log('Five documented journeys — see ground-truth/journeys.json\n');
});
