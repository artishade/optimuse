#ifndef RUNNER_ENGINE_CHANNEL_LIFETIME_H_
#define RUNNER_ENGINE_CHANNEL_LIFETIME_H_

#include <flutter/flutter_engine.h>

#include <functional>

using OptimuseEngineChannelShutdown = std::function<void()>;

/// Registers cleanup that runs while the supplied engine messenger is valid.
void RegisterOptimuseEngineChannelShutdown(
    flutter::FlutterEngine* engine,
    OptimuseEngineChannelShutdown shutdown);

/// Runs and removes cleanup registered for one live Flutter engine.
void ShutdownOptimuseEngineChannels(flutter::FlutterEngine* engine);

/// Runs and removes cleanup registered for every live Flutter engine.
void ShutdownAllOptimuseEngineChannels();

#endif  // RUNNER_ENGINE_CHANNEL_LIFETIME_H_
