// A minimal but complete LV2 plugin: stereo audio in/out plus one gain control
// port. Pure C against lv2/core/lv2.h only — no JUCE, no C++ runtime, no
// dependencies to link.
//
// The contract between this file and the Turtle metadata is the set of port
// INDICES and SYMBOLS. connect_port() receives only an integer index; the host
// decides what to pass by reading plugin.ttl. If an index here and an lv2:index
// there disagree, the host hands the gain value to an audio buffer or connects
// nothing at all, and the result is silence or garbage rather than an error.
// tests/templates.test.js asserts that every lv2:symbol in plugin.ttl has a
// matching field in the port struct below, so the two cannot drift silently.

#include <lv2/core/lv2.h>

#include <stdlib.h>

// The plugin's permanent identity. It MUST be a valid URI (RFC 3986), it MUST
// match the subject of plugin.ttl and manifest.ttl exactly, and it must never
// change once the plugin is released: hosts key presets, GUI state and
// patch files by this string. `urn:<vendor>:<plugin>` from a scaffold is a
// placeholder — replace it with a URI you actually control before shipping.
#define {{PLUGIN_ID}}_URI "{{PLUGIN_URI}}"

// Port indices, in one place so the switch in connect_port() and the lv2:index
// values in plugin.ttl are visibly the same list.
enum {
    PORT_GAIN  = 0,
    PORT_IN_L  = 1,
    PORT_IN_R  = 2,
    PORT_OUT_L = 3,
    PORT_OUT_R = 4
};

typedef struct {
    // One field per port. The names match the lv2:symbol values in plugin.ttl.
    // Control and audio *inputs* are const: the plugin must not write to a
    // buffer the host may be sharing with another plugin or with itself
    // (lv2:inPlaceBroken).
    const float *gain;
    const float *in_l;
    const float *in_r;
    float       *out_l;
    float       *out_r;

    double sample_rate;
} {{PLUGIN_ID}};

static LV2_Handle instantiate(const LV2_Descriptor *descriptor,
                              double                sample_rate,
                              const char           *bundle_path,
                              const LV2_Feature *const *features)
{
    (void) descriptor;   // this library exports a single descriptor
    (void) bundle_path;  // no external resources to load from the bundle
    (void) features;     // no required features; nothing to look up

    // calloc, not malloc: every port pointer starts NULL, so run() can detect a
    // port the host never connected instead of dereferencing garbage.
    {{PLUGIN_ID}} *self = ({{PLUGIN_ID}} *) calloc(1, sizeof({{PLUGIN_ID}}));
    if (self == NULL) {
        return NULL;   // NULL is how instantiate() reports failure
    }

    self->sample_rate = sample_rate;
    return (LV2_Handle) self;
}

static void connect_port(LV2_Handle instance, uint32_t port, void *data_location)
{
    {{PLUGIN_ID}} *self = ({{PLUGIN_ID}} *) instance;

    switch (port) {
        case PORT_GAIN:  self->gain  = (const float *) data_location; break;
        case PORT_IN_L:  self->in_l  = (const float *) data_location; break;
        case PORT_IN_R:  self->in_r  = (const float *) data_location; break;
        case PORT_OUT_L: self->out_l = (float *) data_location;       break;
        case PORT_OUT_R: self->out_r = (float *) data_location;       break;
        default: break;   // an index we never declared — ignore, do not crash
    }
}

static void activate(LV2_Handle instance)
{
    // lv2core says state initialisation belongs here rather than in
    // instantiate(), because activate() runs again after every deactivate().
    // This plugin keeps no running state between blocks, so there is nothing to
    // reset — but keep the override: the host may call it at any time.
    (void) instance;
}

static void run(LV2_Handle instance, uint32_t sample_count)
{
    const {{PLUGIN_ID}} *self = (const {{PLUGIN_ID}} *) instance;

    // A conforming host connects every declared port before the first run(), so
    // these are non-NULL in practice. The guard is cheap and turns a malformed
    // host into silence instead of a crash — and a crash inside a plugin takes
    // the whole DAW process down with it.
    if (self->gain == NULL || self->in_l == NULL || self->in_r == NULL
        || self->out_l == NULL || self->out_r == NULL) {
        return;
    }

    // Read the control port ONCE per block. An lv2:ControlPort holds a single
    // value that is constant for the whole run() call, so dereferencing it per
    // sample would be both slower and semantically wrong. (Per-sample control
    // automation needs the lv2:atom extension and an lv2:CVPort instead.)
    const float gain = *self->gain;

    for (uint32_t i = 0; i < sample_count; ++i) {
        self->out_l[i] = self->in_l[i] * gain;
        self->out_r[i] = self->in_r[i] * gain;
    }
}

static void deactivate(LV2_Handle instance)
{
    (void) instance;   // no running state to stop
}

static void cleanup(LV2_Handle instance)
{
    free(instance);   // pairs with the calloc in instantiate()
}

static const void *extension_data(const char *uri)
{
    (void) uri;
    // MUST return NULL for any URI we do not support. This plugin implements no
    // extensions (no lv2:state, lv2:options, lv2:ui, ...).
    return NULL;
}

static const LV2_Descriptor descriptor = {
    // Designated initialisers, not positional ones. LV2_Descriptor has eight
    // fields and a positional initialiser compiles happily with the wrong order
    // as long as the types line up — run and connect_port are both
    // void(*)(LV2_Handle, uint32_t, ...) shaped enough to swap unnoticed.
    .URI            = {{PLUGIN_ID}}_URI,
    .instantiate    = instantiate,
    .connect_port   = connect_port,
    .activate       = activate,
    .run            = run,
    .deactivate     = deactivate,
    .cleanup        = cleanup,
    .extension_data = extension_data
};

// The single entry point. A host dlopen()s the bundle binary and calls this with
// index 0 to obtain the descriptor; any other index must yield NULL.
// LV2_SYMBOL_EXPORT expands to the platform's visibility/dllexport qualifier.
LV2_SYMBOL_EXPORT const LV2_Descriptor *lv2_descriptor(uint32_t index)
{
    return (index == 0) ? &descriptor : NULL;
}
