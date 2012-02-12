//import "ics.js"
//import "cpe.js"
//import "cce.js"

AACDecoder = Decoder.extend(function() {
    Decoder.register('mp4a', this)
    Decoder.register('aac ', this)
    
    const SAMPLE_RATES = new Int32Array([
        96000, 88200, 64000, 48000, 44100, 32000,
        24000, 22050, 16000, 12000, 11025, 8000, 7350    
    ]);
    
    // AAC profiles
    const AOT_AAC_MAIN = 1,
          AOT_AAC_LC = 2,
          AOT_AAC_LTP = 4,
          AOT_ESCAPE = 31;
          
    // Channel configurations
    const CHANNEL_CONFIG_NONE = 0,
          CHANNEL_CONFIG_MONO = 1,
          CHANNEL_CONFIG_STEREO = 2,
          CHANNEL_CONFIG_STEREO_PLUS_CENTER = 3,
          CHANNEL_CONFIG_STEREO_PLUS_CENTER_PLUS_REAR_MONO = 4,
          CHANNEL_CONFIG_FIVE = 5,
          CHANNEL_CONFIG_FIVE_PLUS_ONE = 6,
          CHANNEL_CONFIG_SEVEN_PLUS_ONE = 8;
    
    this.prototype.setCookie = function(buffer) {
        var data = Stream.fromBuffer(buffer),
            stream = new Bitstream(data);
        
        this.config = {};
        
        this.config.profile = stream.readSmall(5);
        if (this.config.profile === AOT_ESCAPE)
            this.config.profile = 32 + stream.readSmall(6);
            
        this.config.sampleIndex = stream.readSmall(4);
        this.config.sampleRate = (this.config.sampleIndex === 0x0f ? stream.read(24) : SAMPLE_RATES[this.config.sampleIndex]);
            
        this.config.chanConfig = stream.readSmall(4);
        
        switch (this.config.profile) {
            case AOT_AAC_MAIN:
            case AOT_AAC_LC:
            case AOT_AAC_LTP:
                if (stream.readOne()) // frameLengthFlag
                    return this.emit('error', 'frameLengthFlag not supported');
                    
                this.config.frameLength = 1024;
                    
                if (stream.readOne()) // dependsOnCoreCoder
                    stream.advance(14); // coreCoderDelay
                    
                if (stream.readOne()) { // extensionFlag
                    if (this.config.profile > 16) { // error resiliant profile
                        this.config.sectionDataResilience = stream.readOne();
                        this.config.scalefactorResilience = stream.readOne();
                        this.config.spectralDataResilience = stream.readOne();
                    }
                    
                    stream.advance(1);
                }
                
                if (this.config.chanConfig === CHANNEL_CONFIG_NONE) {
                    stream.advance(4) // element_instance_tag
                    this.emit('error', 'PCE unimplemented');
                }
                
                break;
                
            default:
                this.emit('error', 'AAC profile ' + this.config.profile + ' not supported.');
                return;
        }
        
        console.log(this.config);
    }
    
    const SCE_ELEMENT = 0,
          CPE_ELEMENT = 1,
          CCE_ELEMENT = 2,
          LFE_ELEMENT = 3,
          DSE_ELEMENT = 4,
          PCE_ELEMENT = 5,
          FIL_ELEMENT = 6,
          END_ELEMENT = 7;
    
    // line 2139    
    this.prototype.readChunk = function() {
        var stream = this.bitstream;
        
        if (!stream.available(1))
            return this.once('available', this.readChunk);
        
        if (stream.peek(12) === 0xfff) {
            this.emit('error', 'adts header') // NOPE
        }
        
        this.cces = [];
        var elements = [],
            config = this.config,
            frameLength = config.frameLength,
            elementType = null;
            
        while ((elementType = stream.readSmall(3)) !== END_ELEMENT) {
            var id = stream.readSmall(4);
            
            switch (elementType) {
                case SCE_ELEMENT:
                case LFE_ELEMENT:
                    console.log('sce or lfe')
                    //this.decodeICS(false);
                    var ics = new ICStream(frameLength);
                    ics.id = id;
                    elements.push(ics);
                    ics.decode(stream, config, false);
                    break;
                    
                case CPE_ELEMENT:
                    console.log('cpe')
                    var cpe = new CPEElement(frameLength);
                    cpe.id = id;
                    elements.push(cpe);
                    cpe.decode(stream, config);
                    break;
                    
                case CCE_ELEMENT:
                    console.log('cce')
                    var cce = new CCEElement(frameLength);
                    this.cces.push(cce);
                    cce.decode(stream, config);
                    break;
                    
                case DSE_ELEMENT:
                    console.log('dse')
                    break;
                    
                case PCE_ELEMENT:
                    console.log('pce')
                    break;
                    
                case FIL_ELEMENT:
                    console.log('fil')
                    
                    if (id === 15)
                        id += stream.read(8) - 1;
                        
                    // decode_extension_payload
                    
                    break;
                    
                default:
                    return this.emit('error', 'Unknown element')
            }
        }
        
        console.log(elements);
        this.process(elements);
    }
    
    this.prototype.process = function(elements) {
        var channels = this.config.chanConfig;
        
        // if (channels === 1 && psPresent)
        // sbrPresent?
        var mult = 1;
        
        var len = mult * this.config.frameLength;
        var data = [];
        
        var channel = 0;
        for (var i = 0; i < elements.length && channel < channels; i++) {
            var e = elements[i];
            
            if (e instanceof ICStream) { // SCE or LFE element
                channel += this.processSingle(e, channel);
            } else if (e instanceof CPEElement) {
                channel += this.processPair(e, channel);
            } else {
                throw new Error("Unknown element found.")
            }
        }
    }
    
    this.prototype.processPair = function(element, channel) {
        var profile = this.config.profile,
            left = element.left,
            right = element.right,
            l_info = left.info,
            r_info = right.info,
            l_data = left.data,
            r_data = right.data;
            
        if (element.commonWindow && element.maskPresent)
            throw new Error("MS unimplemented");
            
        if (profile === AOT_AAC_MAIN)
            throw new Error("Main prediction unimplemented");
            
        // IS
            
        if (profile === AOT_AAC_LTP)
            throw new Error("LTP prediction unimplemented");
            
        this.applyChannelCoupling(element, CCEElement.BEFORE_TNS, l_data, r_data);
        
        if (left.tnsPresent)
            throw new Error("TNS processing unimplemented");
            
        if (right.tnsPresent)
            throw new Error("TNS processing unimplemented");
        
        this.applyChannelCoupling(element, CCEElement.AFTER_TNS, l_data, r_data);
        
        // filterbank
        
        if (profile === AOT_AAC_LTP)
            throw new Error("LTP prediction unimplemented");
        
        this.applyChannelCoupling(element, CCEElement.AFTER_IMDCT, data[channel], data[channel + 1]);
        
        if (left.gainPresent)
            throw new Error("Gain control not implemented");
            
        if (right.gainPresent)
            throw new Error("Gain control not implemented");
            
        if (this.sbrPresent)
            throw new Error("SBR not implemented");
    }
    
    this.prototype.applyChannelCoupling = function(element, couplingPoint, data1, data2) {
        var cces = this.cces,
            isChannelPair = element instanceof CPEElement,
            applyCoupling = couplingPoint === CCEElement.AFTER_IMDCT ? 'applyIndependentCoupling' : 'applyDependentCoupling';
        
        for (var i = 0; i < cces.length; i++) {
            var cce = cces[i],
                index = 0;
                
            if (cce.couplingPoint === couplingPoint) {
                for (var c = 0; c < cce.coupledCount; c++) {
                    var chSelect = cce.chSelect[c];
                    if (cce.channelPair[c] === isChannelPair && cce.idSelect[c] === element.id) {
                        if (chSelect !== 1) {
                            cce[applyCoupling](index, data1);
                            if (chSelect) index++;
                        }
                        
                        if (chSelect !== 2)
                            cce[applyCoupling](index++, data2);
                            
                    } else {
                        index += 1 + (chSelect === 3 ? 1 : 0);
                    }
                }
            }
        }
    }
})