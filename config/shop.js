// ---------------------------------------------------------------------------
// Good Vibes Cafe - shop ki settings ek hi jagah.
// Naam / address / phone .env se aate hain (SHOP_NAME, SHOP_ADDRESS, SHOP_PHONE ...).
// GST on/off aur bill ka output (thermal / PDF / WhatsApp) yahin se control hota hai.
//
// NOTE: env values function ke andar padhi jaati hain (import ke waqt nahi),
// kyunki dotenv.config() imports ke BAAD chalta hai.
// ---------------------------------------------------------------------------
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_DIR = path.join(__dirname, "../assets/logos");

export const getShop = () => {
  const e = process.env;
  return {
    key: "cafe",
    name: e.SHOP_NAME || "Good Vibes Cafe",
    address: e.SHOP_ADDRESS || "",
    phone: e.SHOP_PHONE || "",
    email: e.SHOP_EMAIL || "",
    gstin: "",
    state: "",
    billPrefix: e.BILL_PREFIX || "GVC",
    gstEnabled: false, // GST nahi lagti
    logoFile: "logo.png", // backend/assets/logos/logo.png
    footer: e.SHOP_FOOTER || "Thank you! Visit again",
    // Bill kaise dena hai
    output: { thermal: true, pdf: false, whatsapp: false },
  };
};

// Frontend ko jo info chahiye
export const publicShopInfo = (shop) => ({
  key: shop.key,
  name: shop.name,
  address: shop.address,
  phone: shop.phone,
  gstEnabled: shop.gstEnabled,
  output: shop.output,
  logoUrl: `/logos/${shop.logoFile}`,
});
