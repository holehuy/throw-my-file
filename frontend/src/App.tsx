import { ToastContainer } from "react-toastify";
import "./App.css";
import Home from "./pages/Home";

function App() {
  return (
    <>
      <div>
        <ToastContainer
          position="top-right"
          autoClose={2000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
        <Home />
      </div>
    </>
  );
}

export default App;
