import pyaudio

p = pyaudio.PyAudio()
try:
    d = p.get_default_input_device_info()
    print(f"DEFAULT_INPUT: [{d['index']}] {d['name']}")
except Exception as e:
    print(f"DEFAULT_INPUT_ERROR: {e}")
print("--- INPUT DEVICES ---")
for i in range(p.get_device_count()):
    info = p.get_device_info_by_index(i)
    if int(info["maxInputChannels"]) > 0:
        print(
            f"{i}: {info['name']} "
            f"ch={info['maxInputChannels']} rate={int(info['defaultSampleRate'])}"
        )
p.terminate()
