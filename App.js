import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "./lib/supabase";

WebBrowser.maybeCompleteAuthSession();

const SITE = "https://jewelry-shop-orpin-one.vercel.app";
const PLUM = "#4a1942";
const BLUSH = "#fbeff4";
const PINK = "#d9a0bb";
const CHECKOUT_URL = SITE + "/api/checkout";

const imageUrl = (p) =>
  !p
    ? null
    : (p.startsWith("http") ? p : SITE + (p.startsWith("/") ? p : "/" + p)) + "?v=2";

async function signInWithGoogle() {
  const redirectTo = Linking.createURL("/");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return alert(error.message);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === "success") {
    const params = new URLSearchParams(result.url.split("#")[1] || "");
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
    } else {
      alert("Login finished but no session came back. Check the Redirect URLs setting.");
    }
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState([]);
  const [items, setItems] = useState([]);
  const [screen, setScreen] = useState("shop");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState(null);

  // Who is signed in?
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Products
  useEffect(() => {
    if (!user) return;
    supabase
      .from("products")
      .select("*")
      .order("id")
      .then(({ data, error }) => {
        if (error) alert(error.message);
        else setProducts(data || []);
      });
  }, [user]);

  // Read the cart from the database
  const fetchCart = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from("cart_items")
      .select("quantity, products(id, name, price, image_url)")
      .eq("user_id", uid)
      .order("id");
    if (error) return console.log("Cart load failed:", error.message);
    setItems(
      (data || [])
        .filter((r) => r.products)
        .map((r) => ({
          id: r.products.id,
          name: r.products.name,
          price: Number(r.products.price),
          image_url: r.products.image_url,
          quantity: r.quantity,
        }))
    );
  }, []);

  // Load the cart and listen for live changes from any device
  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    fetchCart(user.id);
    const channel = supabase
      .channel("cart-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "cart_items" }, () =>
        fetchCart(user.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchCart]);

  const saveQty = async (productId, quantity) => {
    if (quantity <= 0) {
      await supabase.from("cart_items").delete().eq("user_id", user.id).eq("product_id", productId);
    } else {
      await supabase
        .from("cart_items")
        .upsert({ user_id: user.id, product_id: productId, quantity }, { onConflict: "user_id,product_id" });
    }
    fetchCart(user.id);
  };

  const addItem = (product) => {
    const current = items.find((i) => i.id === product.id);
    saveQty(product.id, (current?.quantity || 0) + 1);
  };

  const placeOrder = async () => {
    if (!name.trim() || !address.trim()) return alert("Please fill in your name and address.");
    if (items.length === 0) return alert("Your cart is empty.");
    setPlacing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(CHECKOUT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          name,
          address,
          phone,
          items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Checkout failed.");
        return;
      }
      await supabase.from("cart_items").delete().eq("user_id", user.id);
      await fetchCart(user.id);
      setOrder({ id: json.orderId, emailSent: json.emailSent });
      setScreen("done");
    } catch (e) {
      alert("Could not reach the shop: " + e.message);
    } finally {
      setPlacing(false);
    }
  };

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const total = items.reduce((n, i) => n + i.price * i.quantity, 0);

  if (!ready) {
    return (
      <View style={[styles.center, { backgroundColor: BLUSH }]}>
        <ActivityIndicator color={PLUM} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.center, { backgroundColor: BLUSH }]}>
        <Text style={styles.brand}>Lumière</Text>
        <Text style={styles.sub}>Sign in to shop</Text>
        <Pressable style={styles.button} onPress={signInWithGoogle}>
          <Text style={styles.buttonText}>Continue with Google</Text>
        </Pressable>
      </View>
    );
  }

  if (screen === "checkout") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: BLUSH }}>
        <View style={styles.header}>
          <Text style={styles.brand}>Checkout</Text>
          <Pressable onPress={() => setScreen("cart")}>
            <Text style={{ color: PLUM }}>Back</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <TextInput style={styles.input} placeholder="Full name" value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Delivery address" value={address} onChangeText={setAddress} multiline />
          <TextInput style={styles.input} placeholder="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Text style={styles.sub}>{count} item(s) · Total ${total.toFixed(2)}</Text>
          <Pressable
            style={[styles.button, { alignItems: "center", opacity: placing ? 0.6 : 1 }]}
            disabled={placing}
            onPress={placeOrder}
          >
            <Text style={styles.buttonText}>{placing ? "Placing order..." : "Place order"}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === "done") {
    return (
      <View style={[styles.center, { backgroundColor: BLUSH }]}>
        <Text style={styles.brand}>Thank you!</Text>
        <Text style={styles.sub}>Your order {order ? String(order.id) : ""} was placed.</Text>
        <Text style={styles.sub}>
          {order?.emailSent ? "A confirmation email is on its way." : "Your order is saved."}
        </Text>
        <Pressable style={styles.button} onPress={() => setScreen("shop")}>
          <Text style={styles.buttonText}>Keep shopping</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BLUSH }}>
      <View style={styles.header}>
        <Text style={styles.brand}>Lumière</Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable onPress={() => setScreen(screen === "shop" ? "cart" : "shop")}>
            <Text style={{ color: PLUM, fontWeight: "600" }}>
              {screen === "shop" ? `Cart (${count})` : "Shop"}
            </Text>
          </Pressable>
          <Pressable onPress={() => supabase.auth.signOut()}>
            <Text style={{ color: PLUM }}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      {screen === "shop" ? (
        <FlatList
          data={products}
          keyExtractor={(p) => String(p.id)}
          numColumns={2}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {imageUrl(item.image_url) && (
                <Image source={{ uri: imageUrl(item.image_url) }} style={styles.image} />
              )}
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.price}>${Number(item.price).toFixed(2)}</Text>
              <Pressable style={styles.addButton} onPress={() => addItem(item)}>
                <Text style={styles.buttonText}>Add</Text>
              </Pressable>
            </View>
          )}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={items}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={{ padding: 12 }}
            ListEmptyComponent={<Text style={styles.sub}>Your cart is empty.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                {imageUrl(item.image_url) && (
                  <Image source={{ uri: imageUrl(item.image_url) }} style={styles.thumb} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.price}>${(item.price * item.quantity).toFixed(2)}</Text>
                </View>
                <Pressable style={styles.qty} onPress={() => saveQty(item.id, item.quantity - 1)}>
                  <Text style={styles.qtyText}>−</Text>
                </Pressable>
                <Text style={styles.qtyNum}>{item.quantity}</Text>
                <Pressable style={styles.qty} onPress={() => saveQty(item.id, item.quantity + 1)}>
                  <Text style={styles.qtyText}>+</Text>
                </Pressable>
              </View>
            )}
          />
          <View style={styles.footer}>
            <Text style={styles.brand}>Total: ${total.toFixed(2)}</Text>
            {items.length > 0 && (
              <Pressable
                style={[styles.button, { alignItems: "center", marginTop: 10 }]}
                onPress={() => setScreen("checkout")}
              >
                <Text style={styles.buttonText}>Checkout</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  brand: { fontSize: 24, fontWeight: "700", color: PLUM },
  sub: { color: PLUM, marginVertical: 12, textAlign: "center" },
  button: { backgroundColor: PLUM, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999 },
  addButton: { backgroundColor: PLUM, paddingVertical: 8, borderRadius: 999, alignItems: "center", marginTop: 8 },
  buttonText: { color: "white", fontWeight: "600" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  card: { flex: 1, margin: 6, backgroundColor: "white", borderRadius: 16, padding: 10, borderWidth: 1, borderColor: PINK },
  image: { width: "100%", aspectRatio: 1, borderRadius: 12, backgroundColor: BLUSH },
  name: { color: PLUM, fontWeight: "600", marginTop: 8 },
  price: { color: PLUM, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "white", borderRadius: 16, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: PINK, gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: BLUSH },
  qty: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: PLUM, alignItems: "center", justifyContent: "center" },
  qtyText: { color: PLUM, fontSize: 18 },
  qtyNum: { color: PLUM, fontWeight: "600", minWidth: 20, textAlign: "center" },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: PINK, backgroundColor: "white" },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: PINK, borderRadius: 12, padding: 12, color: PLUM },
});