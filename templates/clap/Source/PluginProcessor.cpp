#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace
{
    const char *const s_features[] = {
        CLAP_PLUGIN_FEATURE_AUDIO_EFFECT,
        CLAP_PLUGIN_FEATURE_STEREO,
        nullptr,
    };

    const clap_plugin_descriptor_t s_descriptor = {
        .clap_version = CLAP_VERSION_INIT,
        .id           = "com.{{BUNDLE_VENDOR}}.{{PLUGIN_ID}}",
        .name         = "{{PLUGIN_DISPLAY_NAME}}",
        .vendor       = "{{VENDOR_CXX}}",
        .url          = "https://{{VENDOR_CXX}}.com/{{PLUGIN_ID}}",
        .manual_url   = "",
        .support_url  = "",
        .version      = "1.0.0",
        .description  = "{{PLUGIN_DESCRIPTION_CXX}}",
        .features     = s_features,
    };

    // The one parameter this scaffold exposes. Kept in one place so
    // get_info(), get_value(), value_to_text() and text_to_value() cannot
    // drift apart.
    constexpr float kGainParamMin = 0.0f;
    constexpr float kGainParamMax = 1.0f;
    constexpr float kGainParamDefault = 0.75f;

    uint32_t CLAP_ABI audioPortsCount(const clap_plugin_t *, bool) {
        return 1;
    }

    bool CLAP_ABI audioPortsGet(const clap_plugin_t *,
                                uint32_t index,
                                bool is_input,
                                clap_audio_port_info_t *info) {
        if (index > 0 || info == nullptr)
            return false;

        *info = {};
        info->id = 0;
        std::snprintf(info->name, sizeof(info->name), "%s",
                      is_input ? "Audio Input" : "Audio Output");
        info->flags = CLAP_AUDIO_PORT_IS_MAIN;
        info->channel_count = 2;
        info->port_type = CLAP_PORT_STEREO;
        info->in_place_pair = 0;
        return true;
    }

    const clap_plugin_audio_ports_t s_audioPorts = {
        .count = &audioPortsCount,
        .get   = &audioPortsGet,
    };

    // ── clap.params ─────────────────────────────────────────────────
    // Without this extension a host can load the plugin but never adjust it:
    // the scaffold's gain would be a compile-time constant from the host's
    // point of view. One automatable gain parameter makes the scaffold a real
    // (if minimal) audio effect.

    {{PLUGIN_CLASS_NAME}} *pluginInstance(const clap_plugin_t *plugin) {
        return plugin != nullptr && plugin->plugin_data != nullptr
            ? static_cast<{{PLUGIN_CLASS_NAME}} *>(plugin->plugin_data)
            : nullptr;
    }

    float clampGain(double value) {
        if (!std::isfinite(value))
            return kGainParamDefault;
        return static_cast<float>(
            value < kGainParamMin ? kGainParamMin
            : value > kGainParamMax ? kGainParamMax
            : value);
    }

    uint32_t CLAP_ABI paramsCount(const clap_plugin_t *) {
        return 1;
    }

    bool CLAP_ABI paramsGetInfo(const clap_plugin_t *,
                                uint32_t index,
                                clap_param_info_t *info) {
        if (index > 0 || info == nullptr)
            return false;

        *info = {};
        info->id = {{PLUGIN_CLASS_NAME}}::kGainParamId;
        info->flags = CLAP_PARAM_IS_AUTOMATABLE;
        info->cookie = nullptr;
        std::snprintf(info->name, sizeof(info->name), "%s", "Gain");
        info->module[0] = '\0'; // top level: no module path
        info->min_value = kGainParamMin;
        info->max_value = kGainParamMax;
        info->default_value = kGainParamDefault;
        return true;
    }

    bool CLAP_ABI paramsGetValue(const clap_plugin_t *plugin,
                                 clap_id param_id,
                                 double *out_value) {
        const auto *self = pluginInstance(plugin);
        if (self == nullptr || param_id != {{PLUGIN_CLASS_NAME}}::kGainParamId || out_value == nullptr)
            return false;

        *out_value = self->gain();
        return true;
    }

    bool CLAP_ABI paramsValueToText(const clap_plugin_t *,
                                    clap_id param_id,
                                    double value,
                                    char *out_buffer,
                                    uint32_t out_buffer_capacity) {
        if (param_id != {{PLUGIN_CLASS_NAME}}::kGainParamId
            || out_buffer == nullptr || out_buffer_capacity == 0)
            return false;

        const auto percent = clampGain(value) * 100.0;
        const auto written = std::snprintf(out_buffer, out_buffer_capacity,
                                           "%.0f %%", percent);
        return written > 0 && static_cast<uint32_t>(written) < out_buffer_capacity;
    }

    bool CLAP_ABI paramsTextToValue(const clap_plugin_t *,
                                    clap_id param_id,
                                    const char *param_value_text,
                                    double *out_value) {
        if (param_id != {{PLUGIN_CLASS_NAME}}::kGainParamId
            || param_value_text == nullptr || out_value == nullptr)
            return false;

        // Accept "75", "75 %" and "75%" — the number is a percentage, matching
        // value_to_text(). Rejecting text that contains no number at all keeps
        // the host's error reporting meaningful.
        char *end = nullptr;
        const auto percent = std::strtod(param_value_text, &end);
        if (end == param_value_text)
            return false;

        *out_value = clampGain(percent / 100.0);
        return true;
    }

    void CLAP_ABI paramsFlush(const clap_plugin_t *plugin,
                              const clap_input_events_t *in,
                              const clap_output_events_t *out) {
        auto *self = pluginInstance(plugin);
        if (self != nullptr)
            self->applyParameterEvents(in);

        // The host drives the gain; this plugin has no UI of its own and never
        // emits parameter events, so there is nothing to push to `out`.
        (void) out;
    }

    const clap_plugin_params_t s_params = {
        .count         = &paramsCount,
        .get_info      = &paramsGetInfo,
        .get_value     = &paramsGetValue,
        .value_to_text = &paramsValueToText,
        .text_to_value = &paramsTextToValue,
        .flush         = &paramsFlush,
    };

    // ── clap.state ──────────────────────────────────────────────────
    // The params documentation is explicit: without the state extension a host
    // must not try to remember parameter values itself, so the plugin would
    // silently lose its settings between sessions. The format is a version
    // word followed by the gain as a raw float — deliberately not a
    // cross-platform serialisation; replace it when you add real state.

    // CLAP streams may deliver fewer bytes than requested per call (like
    // POSIX read()/write()) — clap-validator exercises this with streams that
    // hand out 17 bytes at a time. Loop until the whole field moved.
    bool writeFully(const clap_ostream_t *stream, const void *src, size_t size) {
        auto *out = static_cast<const uint8_t *>(src);
        while (size > 0) {
            const int64_t n = stream->write(stream, out, size);
            // n < 0 is an error; n == 0 without an error would spin forever.
            if (n <= 0)
                return false;
            out += n;
            size -= static_cast<size_t>(n);
        }
        return true;
    }

    bool readFully(const clap_istream_t *stream, void *dst, size_t size) {
        auto *out = static_cast<uint8_t *>(dst);
        while (size > 0) {
            const int64_t n = stream->read(stream, out, size);
            if (n <= 0)
                return false;
            out += n;
            size -= static_cast<size_t>(n);
        }
        return true;
    }

    bool CLAP_ABI stateSave(const clap_plugin_t *plugin, const clap_ostream_t *stream) {
        const auto *self = pluginInstance(plugin);
        if (self == nullptr || stream == nullptr || stream->write == nullptr)
            return false;

        const uint32_t version = 1;
        const float gain = self->gain();

        return writeFully(stream, &version, sizeof(version))
            && writeFully(stream, &gain, sizeof(gain));
    }

    bool CLAP_ABI stateLoad(const clap_plugin_t *plugin, const clap_istream_t *stream) {
        auto *self = pluginInstance(plugin);
        if (self == nullptr || stream == nullptr || stream->read == nullptr)
            return false;

        uint32_t version = 0;
        float gain = kGainParamDefault;
        if (!readFully(stream, &version, sizeof(version)))
            return false;
        if (version != 1)
            return false; // unknown format: keep defaults rather than guess
        if (!readFully(stream, &gain, sizeof(gain)))
            return false;
        if (!std::isfinite(gain))
            return false; // corrupted payload must not silently become a default

        const auto previousGain = self->gain();
        self->setGainValue(gain);
        // Announce the change: a host that reloads a project would otherwise
        // keep displaying the pre-load values. clap.params.md puts this burden
        // on the plugin (clap_validator fails state-reproducibility without
        // it). state load runs on the main thread, as rescan requires.
        if (self->gain() != previousGain)
            self->requestParamRescan();
        return true;
    }

    const clap_plugin_state_t s_state = {
        .save = &stateSave,
        .load = &stateLoad,
    };
}

const clap_plugin_descriptor_t *{{PLUGIN_ID}}_descriptor() { return &s_descriptor; }

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}(const clap_host_t *host) : m_host(host) {
    m_plugin.desc             = &s_descriptor;
    m_plugin.plugin_data      = this;
    m_plugin.init             = &{{PLUGIN_CLASS_NAME}}::init;
    m_plugin.destroy          = &{{PLUGIN_CLASS_NAME}}::destroy;
    m_plugin.activate         = &{{PLUGIN_CLASS_NAME}}::activate;
    m_plugin.deactivate       = &{{PLUGIN_CLASS_NAME}}::deactivate;
    m_plugin.start_processing = &{{PLUGIN_CLASS_NAME}}::startProcessing;
    m_plugin.stop_processing  = &{{PLUGIN_CLASS_NAME}}::stopProcessing;
    m_plugin.reset            = &{{PLUGIN_CLASS_NAME}}::reset;
    m_plugin.process          = &{{PLUGIN_CLASS_NAME}}::process;
    m_plugin.get_extension    = &{{PLUGIN_CLASS_NAME}}::getExtension;
    m_plugin.on_main_thread   = &{{PLUGIN_CLASS_NAME}}::onMainThread;
}


const clap_plugin_descriptor_t *{{PLUGIN_CLASS_NAME}}::descriptor() const { return &s_descriptor; }

bool {{PLUGIN_CLASS_NAME}}::init(const clap_plugin_t *plugin) {
    auto *self = from(plugin);
    return self != nullptr && self->m_host != nullptr;
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
    // Reset DSP state (filter histories, delay lines, oscillator phase) here.
    // Parameter values must NOT be reset on transport jump / loop reset.
    (void) plugin;
}

clap_process_status {{PLUGIN_CLASS_NAME}}::process(const clap_plugin_t *plugin,
                                                   const clap_process_t *process) {
    auto *self = from(plugin);
    if (self == nullptr || process == nullptr)
        return CLAP_PROCESS_ERROR;

    // Host automation arrives as events. Apply them before touching audio so a
    // block reflects the value the host sent with it; the event's sample offset
    // is deliberately ignored — block-granular gain steps are what the smoothing
    // in a real plugin would hide. flush() shares the same application code.
    self->applyParameterEvents(process->in_events);

    const auto frames = process->frames_count;
    if (frames == 0)
        return CLAP_PROCESS_SLEEP;

    // Transport-only / event-only calls may pass 0 audio ports; returning
    // CLAP_PROCESS_ERROR here fails clap-validator's transport tests.
    if (process->audio_inputs_count == 0 || process->audio_outputs_count == 0)
        return CLAP_PROCESS_CONTINUE;

    const auto &in  = process->audio_inputs[0];
    auto       &out = process->audio_outputs[0];

    if (in.data32 == nullptr || out.data32 == nullptr)
        return CLAP_PROCESS_ERROR;

    const auto channels = std::min<uint32_t>(in.channel_count, out.channel_count);
    const float gain = self->m_gain.load(std::memory_order_relaxed);

    for (uint32_t ch = 0; ch < channels; ++ch) {
        const float *src = in.data32[ch];
        float       *dst = out.data32[ch];

        if (dst == nullptr)
            continue;

        if (src == nullptr) {
            // A missing input channel is silence. Leaving `dst` untouched plays
            // back whatever the host's buffer held from the previous block.
            std::fill(dst, dst + frames, 0.0f);
            continue;
        }

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

const void *{{PLUGIN_CLASS_NAME}}::getExtension(const clap_plugin_t *plugin, const char *id) {
    if (plugin == nullptr || id == nullptr)
        return nullptr;
    if (std::strcmp(id, CLAP_EXT_AUDIO_PORTS) == 0)
        return &s_audioPorts;
    if (std::strcmp(id, CLAP_EXT_PARAMS) == 0)
        return &s_params;
    if (std::strcmp(id, CLAP_EXT_STATE) == 0)
        return &s_state;
    return nullptr;
}

void {{PLUGIN_CLASS_NAME}}::onMainThread(const clap_plugin_t *) {}

void {{PLUGIN_CLASS_NAME}}::setGainValue(float value) {
    m_gain.store(clampGain(value), std::memory_order_relaxed);
}

void {{PLUGIN_CLASS_NAME}}::requestParamRescan() {
    if (m_host == nullptr || m_host->get_extension == nullptr)
        return;

    const auto *hostParams = static_cast<const clap_host_params_t *>(
        m_host->get_extension(m_host, CLAP_EXT_PARAMS));
    if (hostParams != nullptr && hostParams->rescan != nullptr)
        hostParams->rescan(m_host, CLAP_PARAM_RESCAN_VALUES);
}

void {{PLUGIN_CLASS_NAME}}::applyParameterEvents(const clap_input_events_t *events) {
    if (events == nullptr || events->size == nullptr || events->get == nullptr)
        return;

    const auto count = events->size(events);
    for (uint32_t i = 0; i < count; ++i) {
        const auto *header = events->get(events, i);
        if (header == nullptr)
            continue;

        // The type number only means "parameter value" within the core event
        // space. Another event registry (space_id != CLAP_CORE_EVENT_SPACE_ID)
        // may reuse the number for something else entirely, so those events
        // must be ignored — clap_validator's param-set-wrong-namespace test
        // sends exactly such events and checks the values did not move.
        if (header->space_id != CLAP_CORE_EVENT_SPACE_ID)
            continue;

        // Every CLAP event struct starts with its header, so casting the header
        // pointer is the documented way to recover the specific event.
        if (header->type != CLAP_EVENT_PARAM_VALUE)
            continue;

        const auto &event = *reinterpret_cast<const clap_event_param_value_t *>(header);
        if (event.param_id == kGainParamId)
            setGainValue(static_cast<float>(event.value));
    }
}
