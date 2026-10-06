#pragma once
#include <clap/clap.h>

#include <cstdint>

// Shared plugin descriptor. Defined in PluginProcessor.cpp; PluginEntry.cpp uses
// it for the factory's get_plugin_descriptor().
const clap_plugin_descriptor_t *{{PLUGIN_ID}}_descriptor();

// Minimal CLAP plugin implementing the clap_plugin_t vtable directly.
//
// For anything non-trivial, prefer the official C++ glue layer instead:
// https://github.com/free-audio/clap-helpers
//
// Note the modern CLAP API shape: the host reaches plugins through
// clap_entry -> get_factory(CLAP_PLUGIN_FACTORY_ID) -> clap_plugin_factory_t
// -> create_plugin(). There is no get_plugin_count/create_plugin on the entry
// itself; that was the pre-1.0 layout.
class {{PLUGIN_CLASS_NAME}} {
public:
    explicit {{PLUGIN_CLASS_NAME}}(const clap_host_t *host);
    ~{{PLUGIN_CLASS_NAME}}();

    {{PLUGIN_CLASS_NAME}}(const {{PLUGIN_CLASS_NAME}} &) = delete;
    {{PLUGIN_CLASS_NAME}} &operator=(const {{PLUGIN_CLASS_NAME}} &) = delete;

    const clap_plugin_t *clapPlugin() const { return &m_plugin; }
    const clap_plugin_descriptor_t *descriptor() const;

    // ── clap_plugin_t vtable ────────────────────────────────────────
    // CLAP invokes these through the function pointers in m_plugin. They are
    // static and recover the instance from plugin->plugin_data.
    static bool init(const clap_plugin_t *plugin);
    static void destroy(const clap_plugin_t *plugin);
    static bool activate(const clap_plugin_t *plugin,
                         double sample_rate,
                         uint32_t min_frames_count,
                         uint32_t max_frames_count);
    static void deactivate(const clap_plugin_t *plugin);
    static bool startProcessing(const clap_plugin_t *plugin);
    static void stopProcessing(const clap_plugin_t *plugin);
    static void reset(const clap_plugin_t *plugin);
    static clap_process_status process(const clap_plugin_t *plugin, const clap_process_t *process);
    static const void *getExtension(const clap_plugin_t *plugin, const char *id);
    static void onMainThread(const clap_plugin_t *plugin);

private:
    static {{PLUGIN_CLASS_NAME}} *from(const clap_plugin_t *plugin) {
        return static_cast<{{PLUGIN_CLASS_NAME}} *>(plugin->plugin_data);
    }

    clap_plugin_t m_plugin {};
    const clap_host_t *m_host = nullptr;
    double m_sampleRate = 48000.0;
    float m_gain = 1.0f;
    bool m_isActive = false;
    bool m_isProcessing = false;
};
