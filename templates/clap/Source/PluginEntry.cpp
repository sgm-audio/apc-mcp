#include <clap/clap.h>

#include <cstring>

#include "PluginProcessor.h"

// ── clap_plugin_factory ─────────────────────────────────────────────
// The host reaches plugins through clap_entry.get_factory(CLAP_PLUGIN_FACTORY_ID),
// which returns this factory. The pre-1.0 entry layout put get_plugin_count /
// get_plugin_descriptor / create_plugin directly on the entry; that no longer
// exists.

namespace
{
    uint32_t CLAP_ABI factoryGetPluginCount(const clap_plugin_factory_t *) {
        return 1;
    }

    const clap_plugin_descriptor_t *CLAP_ABI factoryGetPluginDescriptor(const clap_plugin_factory_t *,
                                                                       uint32_t index) {
        if (index != 0)
            return nullptr;

        return {{PLUGIN_ID}}_descriptor();
    }

    const clap_plugin_t *CLAP_ABI factoryCreatePlugin(const clap_plugin_factory_t *,
                                                     const clap_host_t *host,
                                                     const char *plugin_id) {
        if (host == nullptr || plugin_id == nullptr)
            return nullptr;

        const auto *desc = {{PLUGIN_ID}}_descriptor();
        if (std::strcmp(plugin_id, desc->id) != 0)
            return nullptr;

        // Ownership passes to the host, which releases it via clap_plugin_t::destroy.
        return (new {{PLUGIN_CLASS_NAME}}(host))->clapPlugin();
    }

    const clap_plugin_factory_t s_pluginFactory = {
        factoryGetPluginCount,
        factoryGetPluginDescriptor,
        factoryCreatePlugin,
    };

    bool CLAP_ABI entryInit(const char * /*plugin_path*/) {
        return true;
    }

    void CLAP_ABI entryDeinit() {}

    const void *CLAP_ABI entryGetFactory(const char *factory_id) {
        if (factory_id == nullptr)
            return nullptr;

        if (std::strcmp(factory_id, CLAP_PLUGIN_FACTORY_ID) == 0)
            return &s_pluginFactory;

        return nullptr;
    }
}

// The symbol the host resolves when it loads the .clap bundle.
CLAP_EXPORT const clap_plugin_entry_t clap_entry = {
    .clap_version = CLAP_VERSION_INIT,
    .init         = entryInit,
    .deinit       = entryDeinit,
    .get_factory  = entryGetFactory,
};
