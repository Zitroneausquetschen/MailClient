import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { useEffect, useCallback } from "react";

// Custom FontSize extension
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return {
      types: ["textStyle"],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

// Custom FontFamily extension
const FontFamily = Extension.create({
  name: "fontFamily",
  addOptions() {
    return {
      types: ["textStyle"],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element) => element.style.fontFamily?.replace(/['"]+/g, ""),
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) return {};
              return { style: `font-family: ${attributes.fontFamily}` };
            },
          },
        },
      },
    ];
  },
});

interface RichTextEditorProps {
  content: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

const FONT_SIZES = ["10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];
const FONT_FAMILIES = [
  { label: "Standard", value: "inherit" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Times New Roman", value: "Times New Roman, serif" },
  { label: "Courier New", value: "Courier New, monospace" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "Trebuchet MS, sans-serif" },
];

const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc",
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff",
  "#0000ff", "#9900ff", "#ff00ff", "#ff6666", "#ffcc66",
];

function MenuBar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const setFontSize = useCallback((size: string) => {
    editor.chain().focus().setMark("textStyle", { fontSize: size }).run();
  }, [editor]);

  const setFontFamily = useCallback((family: string) => {
    if (family === "inherit") {
      editor.chain().focus().unsetMark("textStyle").run();
    } else {
      editor.chain().focus().setMark("textStyle", { fontFamily: family }).run();
    }
  }, [editor]);

  const setColor = useCallback((color: string) => {
    editor.chain().focus().setColor(color).run();
  }, [editor]);

  const setLink = useCallback(() => {
    const url = window.prompt("URL eingeben:", "https://");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  return (
    <div className="border-b border-gray-200 p-2 flex flex-wrap gap-1 items-center bg-gray-50">
      {/* Font Family */}
      <select
        onChange={(e) => setFontFamily(e.target.value)}
        className="text-sm border border-gray-300 rounded px-1 py-0.5 bg-white"
        title="Schriftart"
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>

      {/* Font Size */}
      <select
        onChange={(e) => setFontSize(e.target.value)}
        className="text-sm border border-gray-300 rounded px-1 py-0.5 bg-white w-16"
        title="Schriftgroesse"
        defaultValue="14px"
      >
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size.replace("px", "")}
          </option>
        ))}
      </select>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Bold */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("bold") ? "bg-gray-300" : ""}`}
        title="Fett (Strg+B)"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
        </svg>
      </button>

      {/* Italic */}
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("italic") ? "bg-gray-300" : ""}`}
        title="Kursiv (Strg+I)"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 4h4m-2 0v16m-4 0h8" transform="skewX(-10)" />
        </svg>
      </button>

      {/* Underline */}
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("underline") ? "bg-gray-300" : ""}`}
        title="Unterstrichen (Strg+U)"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v7a5 5 0 0010 0V4M5 20h14" />
        </svg>
      </button>

      {/* Strikethrough */}
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("strike") ? "bg-gray-300" : ""}`}
        title="Durchgestrichen"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v4m0 4v8M4 12h16" />
        </svg>
      </button>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Text Color */}
      <div className="relative group">
        <button
          className="p-1 rounded hover:bg-gray-200 flex items-center"
          title="Textfarbe"
          type="button"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10M12 3v14M8 7l4-4 4 4" />
          </svg>
          <svg className="w-2 h-2 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="absolute hidden group-hover:block top-full left-0 bg-white border border-gray-200 rounded shadow-lg p-2 z-10">
          <div className="grid grid-cols-5 gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setColor(color)}
                className="w-5 h-5 rounded border border-gray-300 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                title={color}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Highlight */}
      <button
        onClick={() => editor.chain().focus().toggleHighlight({ color: "#ffff00" }).run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("highlight") ? "bg-gray-300" : ""}`}
        title="Hervorheben"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Align Left */}
      <button
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive({ textAlign: "left" }) ? "bg-gray-300" : ""}`}
        title="Linksbuendig"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      </button>

      {/* Align Center */}
      <button
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive({ textAlign: "center" }) ? "bg-gray-300" : ""}`}
        title="Zentriert"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M5 18h14" />
        </svg>
      </button>

      {/* Align Right */}
      <button
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive({ textAlign: "right" }) ? "bg-gray-300" : ""}`}
        title="Rechtsbuendig"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M6 18h14" />
        </svg>
      </button>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Bullet List */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("bulletList") ? "bg-gray-300" : ""}`}
        title="Aufzaehlung"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />
        </svg>
      </button>

      {/* Ordered List */}
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("orderedList") ? "bg-gray-300" : ""}`}
        title="Nummerierte Liste"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12" />
          <text x="2" y="7" fontSize="6" fill="currentColor">1</text>
          <text x="2" y="13" fontSize="6" fill="currentColor">2</text>
          <text x="2" y="19" fontSize="6" fill="currentColor">3</text>
        </svg>
      </button>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Link */}
      <button
        onClick={setLink}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("link") ? "bg-gray-300" : ""}`}
        title="Link einfuegen"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>

      {/* Remove Link */}
      {editor.isActive("link") && (
        <button
          onClick={() => editor.chain().focus().unsetLink().run()}
          className="p-1 rounded hover:bg-gray-200"
          title="Link entfernen"
          type="button"
        >
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </button>
      )}

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Blockquote */}
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-1 rounded hover:bg-gray-200 ${editor.isActive("blockquote") ? "bg-gray-300" : ""}`}
        title="Zitat"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Horizontal Rule */}
      <button
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="p-1 rounded hover:bg-gray-200"
        title="Horizontale Linie"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
        </svg>
      </button>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Undo */}
      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Rueckgaengig (Strg+Z)"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      </button>

      {/* Redo */}
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Wiederholen (Strg+Y)"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
        </svg>
      </button>

      {/* Clear Formatting */}
      <button
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        className="p-1 rounded hover:bg-gray-200"
        title="Formatierung entfernen"
        type="button"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

export default function RichTextEditor({
  content,
  onChange,
  placeholder = "Nachricht eingeben...",
  className = "",
  minHeight = "200px",
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      FontFamily,
      Color,
      TextAlign.configure({
        types: ["paragraph"],
      }),
      Link.configure({
        openOnClick: false,
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();
      onChange(html, text);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none p-3",
        style: `min-height: ${minHeight}`,
      },
    },
  });

  // Update content when prop changes (e.g., loading signature)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  return (
    <div className={`border border-gray-300 rounded-md overflow-hidden ${className}`}>
      <MenuBar editor={editor} />
      <div className="bg-white overflow-y-auto" style={{ maxHeight: "400px" }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// Export a function to get the editor instance for external use
export { useEditor };
