import './globals.css';

export const metadata = {
  title: 'DocMind — AI Document Intelligence',
  description: 'Upload PDFs and ask natural language questions powered by GPT-4o',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-inter antialiased bg-gray-50">{children}</body>
    </html>
  );
}
