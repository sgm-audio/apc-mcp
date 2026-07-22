#pragma once
#include <JuceHeader.h>

class {{PLUGIN_CLASS_NAME}};

class WebViewEditor : public juce::AudioProcessorEditor,
                       private juce::Timer {
public:
    explicit WebViewEditor({{PLUGIN_CLASS_NAME}} &);
    ~WebViewEditor() override;

    void resized() override;

private:
    void timerCallback() override;
    void sendStateToJS();
    void handleJSAction(const juce::String &action, const juce::var &data);

    {{PLUGIN_CLASS_NAME}} &m_processor;
    juce::WebBrowserComponent m_webView;
    float m_sentGain = -1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(WebViewEditor)
};
