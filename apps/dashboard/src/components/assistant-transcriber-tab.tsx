/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { AssistantBlock } from '@nia/prism/core/blocks';
import * as React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@dashboard/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/components/ui/select';
import { Switch } from '@dashboard/components/ui/switch';

import { Input } from './ui/input';

// Add this component before AssistantTranscriberTab
const ModelSelector = ({
  provider,
  form
}: {
  provider: string;
  form: UseFormReturn<z.infer<typeof AssistantBlock.AssistantSchema>>;
}) => {
  // Skip rendering for these providers


  const modelOptions = {
    'deepgram': [
      { value: 'nova-2-general', label: 'Nova 2 General' },
      { value: 'nova-2', label: 'Nova 2' },
      { value: 'nova-3', label: 'Nova 3' },
      { value: 'nova-3-general', label: 'Nova 3 General' },
      { value: 'nova-2-meeting', label: 'Nova 2 Meeting' },
      { value: 'nova-2-phone-call', label: 'Nova 2 Phone Call' },
      { value: 'nova-2-finance', label: 'Nova 2 Finance' },
    ],
    'speechmatics': [
      { value: 'default', label: 'Default' },
    ],
    'talkscriber': [
      { value: 'whisper', label: 'Whisper' },
    ],
    'gladia': [
      { value: 'fast', label: 'Fast' },
      { value: 'accurate', label: 'Accurate' },
    ],
    '11labs': [
      { value: 'scribe_v1', label: 'Scribe' },
    ],
  }[provider] || [];


  return (
    <FormField
      control={form.control}
      name='transcriber.model'
      render={({ field }) => (
        <FormItem>
          <FormLabel>Model</FormLabel>
          <Select
            onValueChange={field.onChange}
            value={field.value || ''}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder='Select model'/>
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {modelOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

function AssistantTranscriberTab({
  form,
  selectedAssistant,
}: {
  form: UseFormReturn<z.infer<typeof AssistantBlock.AssistantSchema>>;
  selectedAssistant: AssistantBlock.IAssistant;
}) {
  // Get the current provider value from the form
  const provider = form.watch('transcriber.provider');

  return (
    <div className='p-6 space-y-8 bg-background text-foreground w-full'>
      <div className='space-y-6 w-full'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold'>Transcription Configuration</h2>
            <p className='text-sm text-muted-foreground'>
              Configure the transcription settings for your assistant. Select the provider,
              language, and model for optimal speech-to-text conversion.
            </p>
          </div>
        </div>

        <div className='space-y-6 border p-6 rounded-lg bg-muted/50'>
          <div className='grid gap-6 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='transcriber.provider'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select provider' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value='deepgram'>Deepgram</SelectItem>
                      <SelectItem value='assembly-ai'>Assembly AI</SelectItem>
                      <SelectItem value='talkscriber'>Talkscriber</SelectItem>
                      <SelectItem value='gladia'>Gladia</SelectItem>
                      <SelectItem value='azure'>Azure</SelectItem>
                      <SelectItem value='speechmatics'>Speechmatics</SelectItem>
                      <SelectItem value='11labs'>11Labs</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='transcriber.language'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Language</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder='Select language' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[300px] overflow-y-auto">
                      <SelectItem value='auto'>Auto Detect</SelectItem>
                      {provider === '11labs' ? (
                        <>
                          <SelectItem value='aa'>Afar</SelectItem>
                          <SelectItem value='ab'>Abkhazian</SelectItem>
                          <SelectItem value='ae'>Avestan</SelectItem>
                          <SelectItem value='af'>Afrikaans</SelectItem>
                          <SelectItem value='ak'>Akan</SelectItem>
                          <SelectItem value='am'>Amharic</SelectItem>
                          <SelectItem value='an'>Aragonese</SelectItem>
                          <SelectItem value='ar'>Arabic</SelectItem>
                          <SelectItem value='as'>Assamese</SelectItem>
                          <SelectItem value='av'>Avaric</SelectItem>
                          <SelectItem value='ay'>Aymara</SelectItem>
                          <SelectItem value='az'>Azerbaijani</SelectItem>
                          <SelectItem value='ba'>Bashkir</SelectItem>
                          <SelectItem value='be'>Belarusian</SelectItem>
                          <SelectItem value='bg'>Bulgarian</SelectItem>
                          <SelectItem value='bh'>Bihari</SelectItem>
                          <SelectItem value='bi'>Bislama</SelectItem>
                          <SelectItem value='bm'>Bambara</SelectItem>
                          <SelectItem value='bn'>Bengali</SelectItem>
                          <SelectItem value='bo'>Tibetan</SelectItem>
                          <SelectItem value='br'>Breton</SelectItem>
                          <SelectItem value='bs'>Bosnian</SelectItem>
                          <SelectItem value='ca'>Catalan</SelectItem>
                          <SelectItem value='ce'>Chechen</SelectItem>
                          <SelectItem value='ch'>Chamorro</SelectItem>
                          <SelectItem value='co'>Corsican</SelectItem>
                          <SelectItem value='cr'>Cree</SelectItem>
                          <SelectItem value='cs'>Czech</SelectItem>
                          <SelectItem value='cu'>Church Slavic</SelectItem>
                          <SelectItem value='cv'>Chuvash</SelectItem>
                          <SelectItem value='cy'>Welsh</SelectItem>
                          <SelectItem value='da'>Danish</SelectItem>
                          <SelectItem value='de'>German</SelectItem>
                          <SelectItem value='dv'>Dhivehi</SelectItem>
                          <SelectItem value='dz'>Dzongkha</SelectItem>
                          <SelectItem value='ee'>Ewe</SelectItem>
                          <SelectItem value='el'>Greek</SelectItem>
                          <SelectItem value='en'>English</SelectItem>
                          <SelectItem value='eo'>Esperanto</SelectItem>
                          <SelectItem value='es'>Spanish</SelectItem>
                          <SelectItem value='et'>Estonian</SelectItem>
                          <SelectItem value='eu'>Basque</SelectItem>
                          <SelectItem value='fa'>Persian</SelectItem>
                          <SelectItem value='ff'>Fulah</SelectItem>
                          <SelectItem value='fi'>Finnish</SelectItem>
                          <SelectItem value='fj'>Fijian</SelectItem>
                          <SelectItem value='fo'>Faroese</SelectItem>
                          <SelectItem value='fr'>French</SelectItem>
                          <SelectItem value='fy'>Western Frisian</SelectItem>
                          <SelectItem value='ga'>Irish</SelectItem>
                          <SelectItem value='gd'>Scottish Gaelic</SelectItem>
                          <SelectItem value='gl'>Galician</SelectItem>
                          <SelectItem value='gn'>Guarani</SelectItem>
                          <SelectItem value='gu'>Gujarati</SelectItem>
                          <SelectItem value='gv'>Manx</SelectItem>
                          <SelectItem value='ha'>Hausa</SelectItem>
                          <SelectItem value='he'>Hebrew</SelectItem>
                          <SelectItem value='hi'>Hindi</SelectItem>
                          <SelectItem value='ho'>Hiri Motu</SelectItem>
                          <SelectItem value='hr'>Croatian</SelectItem>
                          <SelectItem value='ht'>Haitian</SelectItem>
                          <SelectItem value='hu'>Hungarian</SelectItem>
                          <SelectItem value='hy'>Armenian</SelectItem>
                          <SelectItem value='hz'>Herero</SelectItem>
                          <SelectItem value='ia'>Interlingua</SelectItem>
                          <SelectItem value='id'>Indonesian</SelectItem>
                          <SelectItem value='ie'>Interlingue</SelectItem>
                          <SelectItem value='ig'>Igbo</SelectItem>
                          <SelectItem value='ii'>Sichuan Yi</SelectItem>
                          <SelectItem value='ik'>Inupiaq</SelectItem>
                          <SelectItem value='io'>Ido</SelectItem>
                          <SelectItem value='is'>Icelandic</SelectItem>
                          <SelectItem value='it'>Italian</SelectItem>
                          <SelectItem value='iu'>Inuktitut</SelectItem>
                          <SelectItem value='ja'>Japanese</SelectItem>
                          <SelectItem value='jv'>Javanese</SelectItem>
                          <SelectItem value='ka'>Georgian</SelectItem>
                          <SelectItem value='kg'>Kongo</SelectItem>
                          <SelectItem value='ki'>Kikuyu</SelectItem>
                          <SelectItem value='kj'>Kuanyama</SelectItem>
                          <SelectItem value='kk'>Kazakh</SelectItem>
                          <SelectItem value='kl'>Kalaallisut</SelectItem>
                          <SelectItem value='km'>Khmer</SelectItem>
                          <SelectItem value='kn'>Kannada</SelectItem>
                          <SelectItem value='ko'>Korean</SelectItem>
                          <SelectItem value='kr'>Kanuri</SelectItem>
                          <SelectItem value='ks'>Kashmiri</SelectItem>
                          <SelectItem value='ku'>Kurdish</SelectItem>
                          <SelectItem value='kv'>Komi</SelectItem>
                          <SelectItem value='kw'>Cornish</SelectItem>
                          <SelectItem value='ky'>Kyrgyz</SelectItem>
                          <SelectItem value='la'>Latin</SelectItem>
                          <SelectItem value='lb'>Luxembourgish</SelectItem>
                          <SelectItem value='lg'>Ganda</SelectItem>
                          <SelectItem value='li'>Limburgan</SelectItem>
                          <SelectItem value='ln'>Lingala</SelectItem>
                          <SelectItem value='lo'>Lao</SelectItem>
                          <SelectItem value='lt'>Lithuanian</SelectItem>
                          <SelectItem value='lu'>Luba-Katanga</SelectItem>
                          <SelectItem value='lv'>Latvian</SelectItem>
                          <SelectItem value='mg'>Malagasy</SelectItem>
                          <SelectItem value='mh'>Marshallese</SelectItem>
                          <SelectItem value='mi'>Maori</SelectItem>
                          <SelectItem value='mk'>Macedonian</SelectItem>
                          <SelectItem value='ml'>Malayalam</SelectItem>
                          <SelectItem value='mn'>Mongolian</SelectItem>
                          <SelectItem value='mr'>Marathi</SelectItem>
                          <SelectItem value='ms'>Malay</SelectItem>
                          <SelectItem value='mt'>Maltese</SelectItem>
                          <SelectItem value='my'>Burmese</SelectItem>
                          <SelectItem value='na'>Nauru</SelectItem>
                          <SelectItem value='nb'>Norwegian Bokmål</SelectItem>
                          <SelectItem value='nd'>North Ndebele</SelectItem>
                          <SelectItem value='ne'>Nepali</SelectItem>
                          <SelectItem value='ng'>Ndonga</SelectItem>
                          <SelectItem value='nl'>Dutch</SelectItem>
                          <SelectItem value='nn'>Norwegian Nynorsk</SelectItem>
                          <SelectItem value='no'>Norwegian</SelectItem>
                          <SelectItem value='nr'>South Ndebele</SelectItem>
                          <SelectItem value='nv'>Navajo</SelectItem>
                          <SelectItem value='ny'>Chichewa</SelectItem>
                          <SelectItem value='oc'>Occitan</SelectItem>
                          <SelectItem value='oj'>Ojibwa</SelectItem>
                          <SelectItem value='om'>Oromo</SelectItem>
                          <SelectItem value='or'>Oriya</SelectItem>
                          <SelectItem value='os'>Ossetian</SelectItem>
                          <SelectItem value='pa'>Punjabi</SelectItem>
                          <SelectItem value='pi'>Pali</SelectItem>
                          <SelectItem value='pl'>Polish</SelectItem>
                          <SelectItem value='ps'>Pashto</SelectItem>
                          <SelectItem value='pt'>Portuguese</SelectItem>
                          <SelectItem value='qu'>Quechua</SelectItem>
                          <SelectItem value='rm'>Romansh</SelectItem>
                          <SelectItem value='rn'>Rundi</SelectItem>
                          <SelectItem value='ro'>Romanian</SelectItem>
                          <SelectItem value='ru'>Russian</SelectItem>
                          <SelectItem value='rw'>Kinyarwanda</SelectItem>
                          <SelectItem value='sa'>Sanskrit</SelectItem>
                          <SelectItem value='sc'>Sardinian</SelectItem>
                          <SelectItem value='sd'>Sindhi</SelectItem>
                          <SelectItem value='se'>Northern Sami</SelectItem>
                          <SelectItem value='sg'>Sango</SelectItem>
                          <SelectItem value='si'>Sinhala</SelectItem>
                          <SelectItem value='sk'>Slovak</SelectItem>
                          <SelectItem value='sl'>Slovenian</SelectItem>
                          <SelectItem value='sm'>Samoan</SelectItem>
                          <SelectItem value='sn'>Shona</SelectItem>
                          <SelectItem value='so'>Somali</SelectItem>
                          <SelectItem value='sq'>Albanian</SelectItem>
                          <SelectItem value='sr'>Serbian</SelectItem>
                          <SelectItem value='ss'>Swati</SelectItem>
                          <SelectItem value='st'>Southern Sotho</SelectItem>
                          <SelectItem value='su'>Sundanese</SelectItem>
                          <SelectItem value='sv'>Swedish</SelectItem>
                          <SelectItem value='sw'>Swahili</SelectItem>
                          <SelectItem value='ta'>Tamil</SelectItem>
                          <SelectItem value='te'>Telugu</SelectItem>
                          <SelectItem value='tg'>Tajik</SelectItem>
                          <SelectItem value='th'>Thai</SelectItem>
                          <SelectItem value='ti'>Tigrinya</SelectItem>
                          <SelectItem value='tk'>Turkmen</SelectItem>
                          <SelectItem value='tl'>Tagalog</SelectItem>
                          <SelectItem value='tn'>Tswana</SelectItem>
                          <SelectItem value='to'>Tonga</SelectItem>
                          <SelectItem value='tr'>Turkish</SelectItem>
                          <SelectItem value='ts'>Tsonga</SelectItem>
                          <SelectItem value='tt'>Tatar</SelectItem>
                          <SelectItem value='tw'>Twi</SelectItem>
                          <SelectItem value='ty'>Tahitian</SelectItem>
                          <SelectItem value='ug'>Uighur</SelectItem>
                          <SelectItem value='uk'>Ukrainian</SelectItem>
                          <SelectItem value='ur'>Urdu</SelectItem>
                          <SelectItem value='uz'>Uzbek</SelectItem>
                          <SelectItem value='ve'>Venda</SelectItem>
                          <SelectItem value='vi'>Vietnamese</SelectItem>
                          <SelectItem value='vo'>Volapük</SelectItem>
                          <SelectItem value='wa'>Walloon</SelectItem>
                          <SelectItem value='wo'>Wolof</SelectItem>
                          <SelectItem value='xh'>Xhosa</SelectItem>
                          <SelectItem value='yi'>Yiddish</SelectItem>
                          <SelectItem value='yo'>Yoruba</SelectItem>
                          <SelectItem value='yue'>Cantonese</SelectItem>
                          <SelectItem value='za'>Zhuang</SelectItem>
                          <SelectItem value='zh'>Chinese</SelectItem>
                          <SelectItem value='zu'>Zulu</SelectItem>
                        </>
                      ) : (provider === 'deepgram' ? ( 
                      <>
                      <SelectItem value='bg'>Bulgarian</SelectItem>
                          <SelectItem value='ca'>Catalan</SelectItem>
                          <SelectItem value='cs'>Czech</SelectItem>
                          <SelectItem value='da'>Danish</SelectItem>
                          <SelectItem value='da-DK'>Danish (Denmark)</SelectItem>
                          <SelectItem value='de'>German</SelectItem>
                          <SelectItem value='de-CH'>German (Switzerland)</SelectItem>
                          <SelectItem value='el'>Greek</SelectItem>
                          <SelectItem value='en'>English</SelectItem>
                          <SelectItem value='en-AU'>English (Australia)</SelectItem>
                          <SelectItem value='en-GB'>English (UK)</SelectItem>
                          <SelectItem value='en-IN'>English (India)</SelectItem>
                          <SelectItem value='en-NZ'>English (New Zealand)</SelectItem>
                          <SelectItem value='en-US'>English (US)</SelectItem>
                          <SelectItem value='es'>Spanish</SelectItem>
                          <SelectItem value='es-419'>Spanish (Latin America)</SelectItem>
                          <SelectItem value='es-LATAM'>Spanish (Latin America)</SelectItem>
                          <SelectItem value='et'>Estonian</SelectItem>
                          <SelectItem value='fi'>Finnish</SelectItem>
                          <SelectItem value='fr'>French</SelectItem>
                          <SelectItem value='fr-CA'>French (Canada)</SelectItem>
                          <SelectItem value='hi'>Hindi</SelectItem>
                          <SelectItem value='hi-Latn'>Hindi (Latin)</SelectItem>
                          <SelectItem value='hu'>Hungarian</SelectItem>
                          <SelectItem value='id'>Indonesian</SelectItem>
                          <SelectItem value='it'>Italian</SelectItem>
                          <SelectItem value='ja'>Japanese</SelectItem>
                          <SelectItem value='ko'>Korean</SelectItem>
                          <SelectItem value='ko-KR'>Korean (South Korea)</SelectItem>
                          <SelectItem value='lt'>Lithuanian</SelectItem>
                          <SelectItem value='lv'>Latvian</SelectItem>
                          <SelectItem value='ms'>Malay</SelectItem>
                          <SelectItem value='multi'>Multiple Languages</SelectItem>
                          <SelectItem value='nl'>Dutch</SelectItem>
                          <SelectItem value='nl-BE'>Dutch (Belgium)</SelectItem>
                          <SelectItem value='no'>Norwegian</SelectItem>
                          <SelectItem value='pl'>Polish</SelectItem>
                          <SelectItem value='pt'>Portuguese</SelectItem>
                          <SelectItem value='pt-BR'>Portuguese (Brazil)</SelectItem>
                          <SelectItem value='ro'>Romanian</SelectItem>
                          <SelectItem value='ru'>Russian</SelectItem>
                          <SelectItem value='sk'>Slovak</SelectItem>
                          <SelectItem value='sv'>Swedish</SelectItem>
                          <SelectItem value='sv-SE'>Swedish (Sweden)</SelectItem>
                          <SelectItem value='ta'>Tamil</SelectItem>
                          <SelectItem value='taq'>Tamasheq</SelectItem>
                          <SelectItem value='th'>Thai</SelectItem>
                          <SelectItem value='th-TH'>Thai (Thailand)</SelectItem>
                          <SelectItem value='tr'>Turkish</SelectItem>
                          <SelectItem value='uk'>Ukrainian</SelectItem>
                          <SelectItem value='vi'>Vietnamese</SelectItem>
                          <SelectItem value='zh'>Chinese</SelectItem>
                          <SelectItem value='zh-CN'>Chinese (Simplified)</SelectItem>
                          <SelectItem value='zh-Hans'>Chinese (Simplified)</SelectItem>
                          <SelectItem value='zh-Hant'>Chinese (Traditional)</SelectItem>
                          <SelectItem value='zh-TW'>Chinese (Taiwan)</SelectItem>
                        </>):( 
                        <>
                      <SelectItem value='en'>English</SelectItem>
                      <SelectItem value='es'>Spanish</SelectItem>
                      <SelectItem value='fr'>French</SelectItem>
                      <SelectItem value='de'>German</SelectItem>
                        </>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Replace all the provider-specific model fields with this single component */}
          {provider === 'deepgram' && <ModelSelector provider={provider} form={form} />}
          {provider === 'speechmatics' && <ModelSelector provider={provider} form={form} />}
          {provider === 'talkscriber' && <ModelSelector provider={provider} form={form} />}
          {provider === 'gladia' && <ModelSelector provider={provider} form={form} />}
          {provider === '11labs' && <ModelSelector provider={provider} form={form} />}
          <FormField
            control={form.control}
            name='transcriber.backgroundDenoising'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    Background Denoising
                  </FormLabel>
                  <FormDescription>
                    Enable background noise reduction for clearer transcription
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          
          {/* Enhanced Call Control Section */}
          <div className="space-y-4">
            <h3 className="text-md font-medium">Call Control Settings</h3>
            <FormField
              control={form.control}
              name={'endCall' as any}
              render={({ field }) => (
                <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                  <div className='space-y-0.5'>
                    <FormLabel className='text-base'>
                      End Call Function
                    </FormLabel>
                    <FormDescription>
                      Allow the assistant to end calls when appropriate
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          
          {/* Stop Speaking Plan Section */}
          <div className="space-y-4">
            <h3 className="text-md font-medium">Stop Speaking Configuration</h3>
            <p className="text-sm text-muted-foreground">
              Configure when the assistant should stop speaking to allow the user to respond
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name={'transcriber.stopSpeakingPlan.numWords' as any}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Words Limit</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        placeholder="200"
                      />
                    </FormControl>
                    <FormDescription>
                      Maximum number of words before pausing
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={'transcriber.stopSpeakingPlan.backoffSeconds' as any}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Backoff Seconds</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                        placeholder="3"
                      />
                    </FormControl>
                    <FormDescription>
                      Seconds to wait after pausing
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AssistantTranscriberTab;
