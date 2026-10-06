#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>

namespace
{
    const char *const s_features[] = {
        CLAP_PLUGIN_FEATURE_AUDIO_EFFECT,
        CLAP_PLUGIN_FEATURE_STEREO,
        nullptr,
    };

    const clap_plugin_descriptor_t s_descriptor = {
        .clap_version = CLAP_VERSION_INIT,
        .id           = "com.{{VENDOR}}.{{PLUGIN_ID}}",
        .name         = "{{PLUGIN_DISPLAY_NAME}}",
        .vendor       = "{{VENDOR}}",
        .url          = "https://{{VENDOR}}.com/{{PLUGIN_ID}}",
        .manual_url   = "",
        .support_url  = "",
        .version      = "1.0.0",
        .description  = "{{PLUGIN_DESCRIPTION}}",
        .features     = s_features,
    };
}

const clap_plugin_descriptor_t *{{PLUGIN_ID}}_descriptor() { return &s_descriptor; }

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}(const clap_host_t *host) : m_host(host) {
    m_plugin.desc            = &s_descriptor;
    m_plugin.plugin_data     = this;
    m_plugin.init            = &{{PLUGIN_CLASS_NAME}}::init;
    m_plugin.destroy         = &{{PLUGIN_CLASS_NAME}}::destroy;
    m_plugin.activate        = &{{PLUGIN_CLASS_NAME}}::activate;
    m_plugin.deactivate      = &{{PLUGIN_CLASS_NAME}}::deactivate;
    m_plugin.start_processing = &{{PLUGIN_CLASS_NAME}}::startProcessing;
    m_plugin.stop_processing  = &{{PLUGIN_CLASS_NAME}}::stopProcessing;
    m_plugin.reset           = &{{PLUGIN_CLASS_NAME}}::reset;
    m_plugin.process         = &{{PLUGIN_CLASS_NAME}}::process;
    m_plugin.get_extension   = &{{PLUGIN_CLASS_NAME}}::getExtension;
    m_plugin.on_main_thread  = &{{PLUGIN_CLASS_NAME}}::onMainThread;
}

{{PLUGIN_CLASS_NAME}}::~{{PLUGIN_CLASS_NAME}}() = default;

const clap_plugin_descriptor_t *{{PLUGIN_CLASS_NAME}}::descriptor() const { return &s_descriptor; }

bool {{PLUGIN_CLASS_NAME}}::init(const clap_plugin_t *plugin) {
    return from(plugin) != nullptr;
}

void {{PLUGIN_CLASS_NAME}}::destroy(const clap_plugin_t *plugin) {
    delete from(plugin);
}

bool {{PLUGIN_CLASS_NAME}}::activate(const clap_plugin_t *plugin,
                                     double sample_rate,
                                     uint32_t min_frames_count,
                                     uint32_t max_frames_count) {
    auto *self = from(plugin);
    if (self == nullptr || sample_rate <= 0.0)
        return false;

    (void) min_frames_count;
    (void) max_frames_count;

    self->m_sampleRate = sample_rate;
    self->m_isActive   = true;
    return true;
}

void {{PLUGIN_CLASS_NAME}}::deactivate(const clap_plugin_t *plugin) {
    if (auto *self = from(plugin))
        self->m_isActive = false;
}

bool {{PLUGIN_CLASS_NAME}}::startProcessing(const clap_plugin_t *plugin) {
    auto *self = from(plugin);
    if (self == nullptr)
        return false;

    self->m_isProcessing = true;
    return true;
}

void {{PLUGIN_CLASS_NAME}}::stopProcessing(const clap_plugin_t *plugin) {
    if (auto *self = from(plugin))
        self->m_isProcessing = false;
}

void {{PLUGIN_CLASS_NAME}}::reset(const clap_plugin_t *plugin) {
    if (auto *self = from(plugin))
        self->m_gain = 1.0f;
}

clap_process_status {{PLUGIN_CLASS_NAME}}::process(const clap_plugin_t *plugin,
                                                   const clap_process_t *process) {
    auto *self = from(plugin);
    if (self == nullptr || process == nullptr)
        return CLAP_PROCESS_ERROR;

    const auto frames = process->frames_count;
    if (frames == 0)
        return CLAP_PROCESS_SLEEP;

    if (process->audio_inputs_count == 0 || process->audio_outputs_count == 0)
        return CLAP_PROCESS_ERROR;

    const auto &in  = process->audio_inputs[0];
    auto       &out = process->audio_outputs[0];

    if (in.data32 == nullptr || out.data32 == nullptr)
        return CLAP_PROCESS_ERROR;

    const auto channels = std::min<uint32_t>(in.channel_count, out.channel_count);
    const float gain = self->m_gain;

    for (uint32_t ch = 0; ch < channels; ++ch) {
        const float *src = in.data32[ch];
        float       *dst = out.data32[ch];

        if (src == nullptr || dst == nullptr)
            continue;

        for (uint32_t f = 0; f < frames; ++f)
            dst[f] = src[f] * gain;
    }

    // Silence any output channels with no matching input.
    for (uint32_t ch = channels; ch < out.channel_count; ++ch) {
        float *dst = out.data32[ch];
        if (dst == nullptr)
            continue;
        for (uint32_t f = 0; f < frames; ++f)
            dst[f] = 0.0f;
    }

    return CLAP_PROCESS_CONTINUE;
}

const void *{{PLUGIN_CLASS_NAME}}::getExtension(const clap_plugin_t *, const char *) {
    // No extensions implemented yet. Add e.g. CLAP_EXT_AUDIO_PORTS here as the
    // plugin grows.
    return nullptr;
}

void {{PLUGIN_CLASS_NAME}}::onMainThread(const clap_plugin_t *) {}
