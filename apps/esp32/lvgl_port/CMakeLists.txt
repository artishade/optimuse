idf_component_register(
    SRCS "optimuse_lvgl.c" "optimuse_font_zh_14.c" "optimuse_font_emoji_16.c" "optimuse_emoji.c" "optimuse_font_format.c" "optimuse_font_punctuation_14.c" "optimuse_font_digits_28.c" "layout_store.c"
    INCLUDE_DIRS "."
    REQUIRES lvgl__lvgl esp_timer esp_partition spi_flash nvs_flash
)
