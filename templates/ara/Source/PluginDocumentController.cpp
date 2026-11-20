#include "PluginDocumentController.h"
#include "PluginPlaybackRenderer.h"

juce::ARAPlaybackRenderer *{{PLUGIN_CLASS_NAME}}DocumentController::doCreatePlaybackRenderer() noexcept {
    return new {{PLUGIN_CLASS_NAME}}PlaybackRenderer(getDocumentController());
}

bool {{PLUGIN_CLASS_NAME}}DocumentController::doRestoreObjectsFromStream(
    juce::ARAInputStream &input,
    const juce::ARARestoreObjectsFilter *filter) noexcept {
    // The ARA document model is persisted by JUCE and this effect adds no archive payload.
    juce::ignoreUnused(input, filter);
    return true;
}

bool {{PLUGIN_CLASS_NAME}}DocumentController::doStoreObjectsToStream(
    juce::ARAOutputStream &output,
    const juce::ARAStoreObjectsFilter *filter) noexcept {
    // The ARA document model is persisted by JUCE and this effect adds no archive payload.
    juce::ignoreUnused(output, filter);
    return true;
}

const ARA::ARAFactory *JUCE_CALLTYPE createARAFactory() {
    return juce::ARADocumentControllerSpecialisation::createARAFactory<
        {{PLUGIN_CLASS_NAME}}DocumentController>();
}
