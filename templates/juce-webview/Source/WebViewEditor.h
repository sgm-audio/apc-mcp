#pragma once
#include <JuceHeader.h>

#include <functional>
#include <optional>
#include <string>

class {{PLUGIN_CLASS_NAME}};

// juce::WebBrowserComponent::pageAboutToLoad() is a *virtual method*, not a
// std::function callback property — there is no `onPageAboutToLoad` member to
// assign to. The JS -> C++ bridge therefore needs a subclass.
class PluginBrowser : public juce::WebBrowserComponent
{
public:
    using juce::WebBrowserComponent::WebBrowserComponent;

    // Set by the editor. Return true to signal "handled as a message", which
    // blocks the navigation.
    std::function<bool (const juce::String &)> onNavigate;

    bool pageAboutToLoad (const juce::String &newURL) override
    {
        if (onNavigate && onNavigate (newURL))
            return false; // consumed as a JS -> C++ message; do not navigate

        // Only ever allow our own embedded UI. Sub-resources (style.css, app.js)
        // are fetched through the ResourceProvider, not through navigation.
        return newURL == getResourceProviderRoot();
    }
};

class WebViewEditor : public juce::AudioProcessorEditor,
                      private juce::Timer
{
public:
    explicit WebViewEditor ({{PLUGIN_CLASS_NAME}} &);
    ~WebViewEditor() override;

    void resized() override;

private:
    void timerCallback() override;
    void sendStateToJS();

    // Serves Source/UI/* out of BinaryData. Registered via
    // WebBrowserComponent::Options::withResourceProvider.
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String &url);

    // Handles an "apc://callback?action=...&data=..." navigation.
    // Returns true if the URL was consumed.
    bool handleJSAction (const juce::String &url);

    {{PLUGIN_CLASS_NAME}} &m_processor;
    PluginBrowser m_webView;
    float m_sentGain = -1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebViewEditor)
};
