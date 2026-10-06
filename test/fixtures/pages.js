/**
 * Realistic page element fixtures.
 *
 * These were the one genuinely valuable part of the phase5/phase6 development
 * scripts: hand-built element sets covering SPA auth, e-commerce, multi-step
 * forms and large DOMs. The scripts only printed what the detector returned;
 * here the same fixtures back real assertions.
 */

function el(tag, locator, text, intentScore, extra = {}) {
  return {
    path: `body > ${tag}`,
    tag,
    locator,
    text,
    intentScore,
    intentReasons: [tag],
    ...extra,
  };
}

/** Single-page app with a login form and OAuth alternatives. */
export const spaAuthPage = [
  el("input", "#search-nav", "Search", 75),
  el("button", ".nav-home", "Home", 50),
  el("h2", "h2.title", "Sign In", 20),
  el("input", "#email-spa", "Email", 88, { attributes: { type: "email" } }),
  el("input", "#password-spa", "Password", 92, { attributes: { type: "password" } }),
  el("input", "#remember", "Remember me", 40, { attributes: { type: "checkbox" } }),
  el("button", ".btn-login-spa", "Login", 95, { attributes: { type: "submit" } }),
  el("a", ".forgot-password-spa", "Forgot Password?", 65, {
    navigates: true,
    navigationTarget: "#/reset",
  }),
  el("button", ".btn-google", "Login with Google", 80),
  el("button", ".btn-github", "Login with GitHub", 78),
  el("input", "#terms", "I agree to terms", 35, { attributes: { type: "checkbox" } }),
  el("a", ".signup-link-spa", "Create account", 70, {
    navigates: true,
    navigationTarget: "#/signup",
  }),
];

/** E-commerce product detail page with purchase and review actions. */
export const ecommerceProductPage = [
  el("h1", "h1.product", "iPhone 15 Pro", 30),
  el("span", ".price", "$999", 40),
  el("button", ".add-to-cart", "Add to Cart", 95),
  el("button", ".buy-now", "Buy Now", 92),
  el("button", ".wishlist", "Add to Wishlist", 75),
  el("select", "#color", "Color", 70),
  el("select", "#storage", "Storage", 70),
  el("input", "#quantity", "Quantity", 65, { attributes: { type: "number" } }),
  el("h3", "h3.reviews", "Customer Reviews", 20),
  el("button", ".write-review", "Write a Review", 80),
  el("a", ".related-product-1", "iPhone 15", 75, { navigates: true }),
];

/** Multi-step checkout form spanning shipping and payment. */
export const multiStepCheckoutPage = [
  el("input", "#firstName", "First Name", 80, { attributes: { type: "text" } }),
  el("input", "#lastName", "Last Name", 80, { attributes: { type: "text" } }),
  el("input", "#address", "Address", 82, { attributes: { type: "text" } }),
  el("input", "#city", "City", 78, { attributes: { type: "text" } }),
  el("input", "#zip", "Zip Code", 78, { attributes: { type: "text" } }),
  el("select", "#country", "Country", 70),
  el("button", "#shipping-submit", "Continue to Payment", 90, {
    attributes: { type: "submit" },
  }),
  el("input", "#cardName", "Name on Card", 85, { attributes: { type: "text" } }),
  el("input", "#cardNumber", "Card Number", 90, { attributes: { type: "text" } }),
  el("input", "#cardExpiry", "Expiry", 85, { attributes: { type: "text" } }),
  el("input", "#cardCvv", "CVV", 85, { attributes: { type: "password" } }),
  el("button", "#payment-submit", "Place Order", 95, { attributes: { type: "submit" } }),
];

/** Delete-with-confirmation pattern. */
export const deleteConfirmPage = [
  el("button", "#delete-item", "Delete", 90, { ariaLabel: "Delete item" }),
  el("div", "#confirm-dialog", "Are you sure?", 40),
  el("button", "#confirm-yes", "Yes", 85),
  el("button", "#confirm-cancel", "Cancel", 70),
];

/** Search page: query box plus result links. */
export const searchResultsPage = [
  el("input", "#search-input", "Search products", 85, { attributes: { type: "search" } }),
  el("button", "#search-btn", "Search", 80),
  el("select", "#sort", "Sort results", 60),
  el("a", "#result-1", "Laptop Pro 15 product", 75, { navigates: true }),
  el("a", "#result-2", "Wireless Mouse product", 72, { navigates: true }),
];

/** Build a page with `count` interactive elements, for scaling checks. */
export function largePage(count) {
  return Array.from({ length: count }, (_, i) =>
    el("button", `#btn-${i}`, `Action ${i}`, 50 + (i % 40))
  );
}
