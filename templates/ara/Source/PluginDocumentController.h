#pragma once
#include <JuceHeader.h>

class {{PLUGIN_CLASS_NAME}}DocumentController final : public juce::ARADocumentControllerSpecialisation {
public:
    using juce::ARADocumentControllerSpecialisation::ARADocumentControllerSpecialisation;

protected:
    juce::ARAPlaybackRenderer *doCreatePlaybackRenderer() noexcept override;

    bool doRestoreObjectsFromStream(juce::ARAInputStream &input,
                                    const juce::ARARestoreObjectsFilter *filter) noexcept override;
    bool doStoreObjectsToStream(juce::ARAOutputStream &output,
                                const juce::ARAStoreObjectsFilter *filter) noexcept override;
};
