import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://hbdsrmzjiabzykrqfveo.supabase.co",
  "sb_publishable_CqpgrcVsmZt2U7BHyIgghw_J6ab2TvU",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);