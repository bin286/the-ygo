/* Cấu hình đồng bộ (tùy chọn).
   - Để trống như dưới: app lưu TRÊN MÁY (localStorage), hoạt động ngay, không cần tài khoản.
   - Muốn đồng bộ điện thoại <-> máy tính: tạo project Supabase miễn phí,
     rồi dán URL + anon key vào đây (xem README, mục "Bật đồng bộ").  */
window.YGO_CONFIG = {
  supabaseUrl: "",       // vd: "https://abcd1234.supabase.co"
  supabaseAnonKey: "",   // Publishable key (sb_publishable_...) HOẶC legacy anon public (eyJ...). KHÔNG dùng secret/service_role.

  // --- Dịch hiệu ứng thẻ sang tiếng Việt ---
  // Thứ tự ưu tiên: Claude -> Gemini -> dịch máy. Dán key vào ô tương ứng để bật AI.
  // App dịch tự động + lưu cache (mỗi lá chỉ dịch 1 lần), nên chạy nhanh và TỰ CẬP NHẬT cho mọi thẻ.

  // CLAUDE (Anthropic) — chất lượng cao nhất. Key lấy ở https://console.anthropic.com (trả phí theo lượng,
  //   bản Haiku rất rẻ — mỗi lá vài phần nghìn đô, lại được cache nên chỉ dịch 1 lần/lá).
  anthropicApiKey: "",
  anthropicModel: "claude-3-5-haiku-latest",

  // GEMINI (Google) — có hạn mức FREE. Key free ở https://aistudio.google.com/apikey
  geminiApiKey: "",
  geminiModel: "gemini-2.0-flash"

  // Để TRỐNG cả hai: app tự dùng dịch máy miễn phí (MyMemory) + từ điển thuật ngữ YGO, không cần key.
};
